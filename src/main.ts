import "./theme.css";
import "./styles.css";

import "@material/web/button/filled-button.js";
import "@material/web/button/filled-tonal-button.js";
import "@material/web/button/outlined-button.js";
import "@material/web/checkbox/checkbox.js";
import "@material/web/dialog/dialog.js";
import "@material/web/progress/linear-progress.js";
import "@material/web/select/outlined-select.js";
import "@material/web/select/select-option.js";
import "@material/web/switch/switch.js";
import "@material/web/textfield/outlined-text-field.js";

import "./app";

const root = document.querySelector("#app");
if (root && !root.querySelector("app-root")) {
  const appRoot = document.createElement("app-root");
  root.appendChild(appRoot);
}
