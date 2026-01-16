use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::de::Deserializer;
use serde_json::Value;
use uuid::Uuid;

use crate::records::value_to_string;
use crate::state::DatasetStore;

fn normalize_record(value: Value) -> Value {
  match value {
    Value::Object(_) => value,
    other => {
      let mut map = serde_json::Map::new();
      map.insert("value".to_string(), other);
      Value::Object(map)
    }
  }
}

fn detect_format(path: &Path) -> Result<String, String> {
  let ext = path
    .extension()
    .and_then(|s| s.to_str())
    .unwrap_or("")
    .to_lowercase();
  if ext == "csv" {
    return Ok("csv".to_string());
  }
  if ext == "jsonl" {
    return Ok("jsonl".to_string());
  }
  if ext == "json" {
    return Ok("json".to_string());
  }

  let mut file = File::open(path).map_err(|e| e.to_string())?;
  let mut buf = [0u8; 512];
  let read = file.read(&mut buf).map_err(|e| e.to_string())?;
  let snippet = String::from_utf8_lossy(&buf[..read]);
  if snippet.trim_start().starts_with('[') || snippet.trim_start().starts_with('{') {
    Ok("json".to_string())
  } else {
    Ok("csv".to_string())
  }
}

fn stream_json_array<R: Read, F: FnMut(Value) -> Result<(), String>>(
  reader: R,
  mut on_value: F,
) -> Result<(), String> {
  struct ArrayVisitor<F>(F);
  impl<'de, F> serde::de::Visitor<'de> for ArrayVisitor<F>
  where
    F: FnMut(Value) -> Result<(), String>,
  {
    type Value = ();

    fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
      formatter.write_str("a JSON array")
    }

    fn visit_seq<A>(mut self, mut seq: A) -> Result<Self::Value, A::Error>
    where
      A: serde::de::SeqAccess<'de>,
    {
      while let Some(value) = seq.next_element::<Value>()? {
        (self.0)(value).map_err(serde::de::Error::custom)?;
      }
      Ok(())
    }
  }

  let mut de = serde_json::Deserializer::from_reader(reader);
  de.deserialize_seq(ArrayVisitor(&mut on_value))
    .map_err(|e| e.to_string())
}

pub fn ingest_dataset(
  path: &Path,
  store_dir: &Path,
  cancel: &AtomicBool,
  mut on_progress: impl FnMut(usize, usize),
) -> Result<DatasetStore, String> {
  fs::create_dir_all(store_dir).map_err(|e| e.to_string())?;
  let dataset_id = Uuid::new_v4().to_string();
  let store_path = store_dir.join(format!("{dataset_id}.jsonl"));
  let mut writer = BufWriter::new(File::create(&store_path).map_err(|e| e.to_string())?);
  let mut offsets = Vec::new();
  let mut fields = HashSet::new();
  let mut offset = 0u64;
  let mut count = 0usize;
  let size_bytes = fs::metadata(path)
    .map(|meta| meta.len())
    .unwrap_or_default();
  let format = detect_format(path)?;

  let mut write_record = |value: Value| -> Result<(), String> {
    if cancel.load(Ordering::SeqCst) {
      return Err("Import canceled".to_string());
    }
    let record = normalize_record(value);
    if let Some(map) = record.as_object() {
      for key in map.keys() {
        fields.insert(key.clone());
      }
    }
    let line = serde_json::to_vec(&record).map_err(|e| e.to_string())?;
    offsets.push(offset);
    writer.write_all(&line).map_err(|e| e.to_string())?;
    writer.write_all(b"\n").map_err(|e| e.to_string())?;
    offset += line.len() as u64 + 1;
    count += 1;
    if count % 500 == 0 {
      on_progress(count, 0);
    }
    Ok(())
  };

  match format.as_str() {
    "csv" => {
      let file = File::open(path).map_err(|e| e.to_string())?;
      let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_reader(file);
      let headers = reader
        .headers()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|s| s.to_string())
        .collect::<Vec<_>>();
      for result in reader.records() {
        let record = result.map_err(|e| e.to_string())?;
        let mut map = serde_json::Map::new();
        for (idx, header) in headers.iter().enumerate() {
          let value = record.get(idx).unwrap_or_default();
          map.insert(header.clone(), Value::String(value.to_string()));
        }
        write_record(Value::Object(map))?;
      }
    }
    "json" | "jsonl" => {
      let mut file = File::open(path).map_err(|e| e.to_string())?;
      let mut probe = [0u8; 128];
      let read = file.read(&mut probe).map_err(|e| e.to_string())?;
      let prefix = String::from_utf8_lossy(&probe[..read]);
      file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
      if prefix.trim_start().starts_with('[') {
        stream_json_array(file, |value| write_record(value))?;
      } else {
        let reader = BufReader::new(file);
        for line in reader.lines() {
          let line = line.map_err(|e| e.to_string())?;
          if line.trim().is_empty() {
            continue;
          }
          let value: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
          write_record(value)?;
        }
      }
    }
    _ => return Err("Unsupported format".to_string()),
  }

  writer.flush().map_err(|e| e.to_string())?;
  let mut fields_list = fields.into_iter().collect::<Vec<_>>();
  fields_list.sort();

  Ok(DatasetStore {
    id: dataset_id,
    source_path: path.to_path_buf(),
    store_path,
    offsets,
    fields: fields_list,
    record_count: count,
    size_bytes,
    format,
  })
}

pub fn read_record_line(store: &DatasetStore, id: usize) -> Result<String, String> {
  if id >= store.offsets.len() {
    return Err("Record id out of range".to_string());
  }
  let mut file = File::open(&store.store_path).map_err(|e| e.to_string())?;
  file
    .seek(SeekFrom::Start(store.offsets[id]))
    .map_err(|e| e.to_string())?;
  let mut reader = BufReader::new(file);
  let mut line = String::new();
  reader.read_line(&mut line).map_err(|e| e.to_string())?;
  Ok(line)
}

pub fn read_record_value(store: &DatasetStore, id: usize) -> Result<Value, String> {
  let line = read_record_line(store, id)?;
  serde_json::from_str(&line).map_err(|e| e.to_string())
}

pub fn export_dataset(
  store: &DatasetStore,
  ids: &[usize],
  path: &Path,
  format: &str,
  cancel: &AtomicBool,
  mut on_progress: impl FnMut(usize, usize),
) -> Result<(), String> {
  if cancel.load(Ordering::SeqCst) {
    return Err("Export canceled".to_string());
  }
  if format == "csv" {
    let mut writer = csv::Writer::from_path(path).map_err(|e| e.to_string())?;
    writer
      .write_record(&store.fields)
      .map_err(|e| e.to_string())?;
    for (idx, id) in ids.iter().enumerate() {
      let record = read_record_value(store, *id)?;
      let mut row = Vec::with_capacity(store.fields.len());
      for field in &store.fields {
        let value = record
          .get(field)
          .map(value_to_string)
          .unwrap_or_default();
        row.push(value);
      }
      writer.write_record(&row).map_err(|e| e.to_string())?;
      if idx % 1000 == 0 {
        on_progress(idx, ids.len());
      }
    }
    writer.flush().map_err(|e| e.to_string())?;
  } else {
    let mut file = BufWriter::new(File::create(path).map_err(|e| e.to_string())?);
    file.write_all(b"[").map_err(|e| e.to_string())?;
    for (idx, id) in ids.iter().enumerate() {
      let line = read_record_line(store, *id)?;
      let trimmed = line.trim();
      if idx > 0 {
        file.write_all(b",\n").map_err(|e| e.to_string())?;
      }
      file
        .write_all(trimmed.as_bytes())
        .map_err(|e| e.to_string())?;
      if idx % 1000 == 0 {
        on_progress(idx, ids.len());
      }
    }
    file.write_all(b"]").map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())?;
  }
  Ok(())
}
