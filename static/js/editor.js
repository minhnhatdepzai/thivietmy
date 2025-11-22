let canvas, ctx;
let originalImage = null;   // dataURL của ảnh gốc
let currentImage = null;    // dataURL của ảnh hiện tại
let undoStack = [];
let redoStack = [];
let cropMode = false;
let isDraggingCrop = false;
let cropStart = null;
let cropEnd = null;

let drawing = false;
let pencilMode = false;
let pencilColorInput, pencilSizeInput;

let camVideo = null;
let camStream = null;
let camCaptureRow = null;
let camCaptureButton = null;

function initEditor() {
  canvas = document.getElementById("editorCanvas");
  ctx = canvas.getContext("2d");

  pencilColorInput = document.getElementById("pencil-color");
  pencilSizeInput = document.getElementById("pencil-size");
  camVideo = document.getElementById("camVideo");
  camCaptureRow = document.getElementById("cam-capture-row");
  camCaptureButton = document.getElementById("btn-capture-photo");

  // Buttons upload / camera
  document.getElementById("btn-upload").addEventListener("click", () => {
    document.getElementById("file-input").click();
  });
  document.getElementById("file-input").addEventListener("change", handleUpload);

  document.getElementById("btn-open-camera").addEventListener("click", startEditorCamera);
  document.getElementById("btn-close-camera").addEventListener("click", stopEditorCamera);

  // Undo / Redo / Original / Delete
  document.getElementById("btn-undo").addEventListener("click", undo);
  document.getElementById("btn-redo").addEventListener("click", redo);
  document.getElementById("btn-original").addEventListener("click", showOriginal);
  document.getElementById("btn-delete-current").addEventListener("click", clearCurrentImage);

  // Filter / transform cơ bản
  document.getElementById("btn-grayscale").addEventListener("click", () => applyFilter("grayscale(1)"));
  document.getElementById("btn-blur").addEventListener("click", () => applyFilter("blur(4px)"));
  document.getElementById("btn-rotate").addEventListener("click", rotate90);
  document.getElementById("btn-flip").addEventListener("click", flipHorizontal);
  document.getElementById("btn-brightness-plus").addEventListener("click", () => applyFilter("brightness(1.2)"));
  document.getElementById("btn-brightness-minus").addEventListener("click", () => applyFilter("brightness(0.8)"));
    // Contrast (khác với brightness)
  document.getElementById("btn-contrast-plus").addEventListener("click", () => applyFilter("contrast(1.2)"));
  document.getElementById("btn-contrast-minus").addEventListener("click", () => applyFilter("contrast(0.8)"));

  document.getElementById("btn-face-blur").addEventListener("click", blurFaceAI);

  // Bút chì
  document.getElementById("btn-pencil").addEventListener("click", enablePencil);
  document.getElementById("btn-pencil-off").addEventListener("click", disablePencil);

  // Download
  document.getElementById("btn-download-png").addEventListener("click", () => downloadImage("png"));
  document.getElementById("btn-download-jpg").addEventListener("click", () => downloadImage("jpeg"));

  // Background & xóa nền
  document.getElementById("btn-blur-bg").addEventListener("click", blurBackgroundAI);
  document.getElementById("btn-change-bg").addEventListener("click", changeBackgroundColor);
  document.getElementById("btn-remove-bg").addEventListener("click", removeBackgroundAI);

  // Tone màu
  document.getElementById("btn-summer-tone").addEventListener("click", () => applyTone("summer"));
  document.getElementById("btn-apply-tone").addEventListener("click", () => {
    const sel = document.getElementById("tone-select");
    if (!sel) return;
    applyTone(sel.value);
  });

  // Emoji
  document.getElementById("btn-emoji-face").addEventListener("click", emojiFace);

  // Crop + Zoom
  document.getElementById("btn-crop").addEventListener("click", cropCenter);
  document.getElementById("btn-crop-manual").addEventListener("click", enableManualCrop);
  document.getElementById("btn-zoom-in").addEventListener("click", () => zoomImage(1.2));
  document.getElementById("btn-zoom-out").addEventListener("click", () => zoomImage(0.8));

  // Nút chụp từ webcam
  camCaptureButton.addEventListener("click", captureFromCamOnce);

  // Vẽ
  canvas.addEventListener("mousedown", startDraw);
  canvas.addEventListener("mousemove", draw);
  canvas.addEventListener("mouseup", endDraw);
  canvas.addEventListener("mouseleave", endDraw);
  canvas.addEventListener("touchstart", startDrawTouch, { passive: false });
  canvas.addEventListener("touchmove", drawTouch, { passive: false });
  canvas.addEventListener("touchend", endDraw);

  // Paste ảnh từ clipboard
  document.addEventListener("paste", handlePaste);

  updatePlaceholder(true);
}

/* --------- Helper UI --------- */

function updatePlaceholder(show) {
  const placeholder = document.getElementById("placeholder");
  if (show) {
    placeholder.style.display = "block";
    canvas.style.display = "none";
  } else {
    placeholder.style.display = "none";
    canvas.style.display = "block";
  }
}

function setCanvasSizeToImage(img) {
  const container = document.getElementById("canvas-container");
  const maxW = container.clientWidth - 20;
  const maxH = container.clientHeight - 20;

  let w = img.width;
  let h = img.height;
  const ratio = Math.min(maxW / w, maxH / h);
  if (ratio < 1) {
    w = w * ratio;
    h = h * ratio;
  }

  canvas.width = w;
  canvas.height = h;
}

/* --------- Load ảnh --------- */

function loadImageToCanvas(src) {
  const img = new Image();
  img.onload = () => {
    setCanvasSizeToImage(img);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    currentImage = canvas.toDataURL("image/png");
    if (!originalImage) {
      originalImage = currentImage;
    }
    pushUndoState();
    updatePlaceholder(false);
  };
  img.src = src;
}

function handleUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (evt) {
    originalImage = null;
    undoStack = [];
    redoStack = [];
    loadImageToCanvas(evt.target.result);
  };
  reader.readAsDataURL(file);
}

/* --------- Paste ảnh --------- */

function handlePaste(e) {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.indexOf("image") !== -1) {
      const blob = item.getAsFile();
      const reader = new FileReader();
      reader.onload = function (evt) {
        originalImage = null;
        undoStack = [];
        redoStack = [];
        loadImageToCanvas(evt.target.result);
      };
      reader.readAsDataURL(blob);
      e.preventDefault();
      break;
    }
  }
}

/* --------- Webcam trong Editor --------- */

async function startEditorCamera() {
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: true });
    camVideo.srcObject = camStream;
    camVideo.classList.remove("hidden");
    if (camCaptureRow) camCaptureRow.style.display = "flex";
  } catch (err) {
    alert("Không mở được camera: " + err);
  }
}

function captureFromCamOnce() {
  if (!camVideo || !camStream) {
    alert("Hãy bật camera trước.");
    return;
  }
  const tempCanvas = document.createElement("canvas");
  const tctx = tempCanvas.getContext("2d");
  tempCanvas.width = camVideo.videoWidth;
  tempCanvas.height = camVideo.videoHeight;
  tctx.drawImage(camVideo, 0, 0, tempCanvas.width, tempCanvas.height);
  const dataUrl = tempCanvas.toDataURL("image/png");

  originalImage = null;
  undoStack = [];
  redoStack = [];
  loadImageToCanvas(dataUrl);
}

function stopEditorCamera() {
  if (camStream) {
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
  }
  if (camVideo) {
    camVideo.srcObject = null;
    camVideo.classList.add("hidden");
  }
  if (camCaptureRow) camCaptureRow.style.display = "none";
}

/* --------- Undo / Redo --------- */

function pushUndoState() {
  if (currentImage) {
    undoStack.push(currentImage);
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
  }
}

function redrawFromDataUrl(dataUrl) {
  const img = new Image();
  img.onload = () => {
    setCanvasSizeToImage(img);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    currentImage = canvas.toDataURL("image/png");
  };
  img.src = dataUrl;
}

function undo() {
  if (undoStack.length <= 1) return;
  const last = undoStack.pop(); // bỏ current
  redoStack.push(last);
  const prev = undoStack[undoStack.length - 1];
  redrawFromDataUrl(prev);
}

function redo() {
  if (redoStack.length === 0) return;
  const next = redoStack.pop();
  undoStack.push(next);
  redrawFromDataUrl(next);
}

/* --------- Bộ lọc & transform --------- */

function applyFilter(filterStr) {
  if (!currentImage) return;
  const img = new Image();
  img.onload = () => {
    setCanvasSizeToImage(img);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.filter = filterStr;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.filter = "none";
    currentImage = canvas.toDataURL("image/png");
    pushUndoState();
  };
  img.src = currentImage;
}

function rotate90() {
  if (!currentImage) return;
  const img = new Image();
  img.onload = () => {
    const w = img.height;
    const h = img.width;
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
    currentImage = canvas.toDataURL("image/png");
    pushUndoState();
  };
  img.src = currentImage;
}

function flipHorizontal() {
  if (!currentImage) return;
  const img = new Image();
  img.onload = () => {
    setCanvasSizeToImage(img);
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(-1, 1);
    ctx.drawImage(img, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();
    currentImage = canvas.toDataURL("image/png");
    pushUndoState();
  };
  img.src = currentImage;
}

/* --------- Crop & Zoom --------- */

// Cắt ảnh: lấy 80% vùng giữa
function cropCenter() {
  if (!currentImage) return;
  const img = new Image();
  img.onload = () => {
    const factor = 0.8;
    const newW = img.width * factor;
    const newH = img.height * factor;
    const sx = (img.width - newW) / 2;
    const sy = (img.height - newH) / 2;

    canvas.width = newW;
    canvas.height = newH;
    ctx.clearRect(0, 0, newW, newH);
    ctx.drawImage(img, sx, sy, newW, newH, 0, 0, newW, newH);
    currentImage = canvas.toDataURL("image/png");
    pushUndoState();
    updatePlaceholder(false);
  };
  img.src = currentImage;
}

// Zoom in/out toàn ảnh
function zoomImage(scaleFactor) {
  if (!currentImage) return;
  const img = new Image();
  img.onload = () => {
    let w = img.width * scaleFactor;
    let h = img.height * scaleFactor;

    const container = document.getElementById("canvas-container");
    const maxW = container.clientWidth - 20;
    const maxH = container.clientHeight - 20;
    const ratio = Math.min(maxW / w, maxH / h, 1); // nếu to quá thì thu lại
    w *= ratio;
    h *= ratio;

    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    currentImage = canvas.toDataURL("image/png");
    pushUndoState();
    updatePlaceholder(false);
  };
  img.src = currentImage;
}

/* --------- Face blur bằng API Flask --------- */

async function blurFaceAI() {
  if (!currentImage) return;
  try {
    const res = await fetch("/api/blur-face", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: currentImage })
    });
    const data = await res.json();

    if (data.image) {
      loadImageToCanvas(data.image);
    } else {
      alert("Không làm mờ được khuôn mặt.");
    }
  } catch (err) {
    alert("Không blur được khuôn mặt: " + err);
  }
}

/* --------- Che mặt bằng emoji (API Flask) --------- */

async function emojiFace() {
  if (!currentImage) return;

  const select = document.getElementById("emoji-select");
  const emoji = select.value;

  try {
    const res = await fetch("/api/emoji-face", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: currentImage,
        emoji: emoji
      })
    });
    const data = await res.json();

    if (data.image) {
      loadImageToCanvas(data.image);
    } else if (data.error) {
      alert("Lỗi emoji: " + data.error);
    }
  } catch (err) {
    alert("Không gắn emoji được: " + err);
  }
}

/* --------- Bút chì vẽ --------- */

function enablePencil() {
  if (!currentImage) return;
  pencilMode = true;
}

function disablePencil() {
  pencilMode = false;
}

function startDraw(e) {
  // Nếu đang ở cropMode: dùng chuột để chọn vùng cắt, không vẽ bút chì
  if (cropMode && currentImage) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    isDraggingCrop = true;
    cropStart = { x, y };
    cropEnd = { x, y };
    drawCropPreview();
    return;
  }

  // Bút chì như cũ
  if (!pencilMode || !currentImage) return;
  drawing = true;
  ctx.lineCap = "round";
  ctx.strokeStyle = pencilColorInput.value;
  ctx.lineWidth = Number(pencilSizeInput.value);
  const rect = canvas.getBoundingClientRect();
  ctx.beginPath();
  ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
}

function draw(e) {
  // Preview vùng crop
  if (cropMode && isDraggingCrop && currentImage) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    cropEnd = { x, y };
    drawCropPreview();
    return;
  }

  if (!drawing) return;
  const rect = canvas.getBoundingClientRect();
  ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
  ctx.stroke();
}


function startDrawTouch(e) {
  if (!pencilMode || !currentImage) return;
  e.preventDefault();
  drawing = true;
  ctx.lineCap = "round";
  ctx.strokeStyle = pencilColorInput.value;
  ctx.lineWidth = Number(pencilSizeInput.value);
  const rect = canvas.getBoundingClientRect();
  const t = e.touches[0];
  ctx.beginPath();
  ctx.moveTo(t.clientX - rect.left, t.clientY - rect.top);
}

function drawTouch(e) {
  if (!drawing) return;
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const t = e.touches[0];
  ctx.lineTo(t.clientX - rect.left, t.clientY - rect.top);
  ctx.stroke();
}

function endDraw() {
  // Kết thúc chọn vùng crop
  if (cropMode && isDraggingCrop && currentImage) {
    isDraggingCrop = false;
    applyCropFromSelection();
    cropMode = false;      // tắt crop mode sau khi cắt xong
    return;
  }

  if (!drawing) return;
  drawing = false;
  currentImage = canvas.toDataURL("image/png");
  pushUndoState();
}


// Bật chế độ cắt theo vùng chọn
function enableManualCrop() {
  if (!currentImage) {
    alert("Hãy tải ảnh hoặc chụp ảnh trước khi cắt.");
    return;
  }
  cropMode = true;
  pencilMode = false; // tắt bút chì nếu đang bật
  alert("Kéo chuột trên ảnh để chọn vùng cần cắt.");
}

// Vẽ preview khung cắt (đường nét đứt)
function drawCropPreview() {
  if (!currentImage || !cropStart || !cropEnd) return;

  const img = new Image();
  img.onload = () => {
    // vẽ lại ảnh gốc
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // vẽ khung chữ nhật
    const x = Math.min(cropStart.x, cropEnd.x);
    const y = Math.min(cropStart.y, cropEnd.y);
    const w = Math.abs(cropEnd.x - cropStart.x);
    const h = Math.abs(cropEnd.y - cropStart.y);

    ctx.save();
    ctx.strokeStyle = "#00ffcc";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  };
  img.src = currentImage;
}

// Thực hiện cắt ảnh theo vùng đã chọn
function applyCropFromSelection() {
  if (!cropStart || !cropEnd || !currentImage) return;

  let x = Math.min(cropStart.x, cropEnd.x);
  let y = Math.min(cropStart.y, cropEnd.y);
  let w = Math.abs(cropEnd.x - cropStart.x);
  let h = Math.abs(cropEnd.y - cropStart.y);

  // vùng quá nhỏ thì bỏ qua
  if (w < 10 || h < 10) {
    // vẽ lại ảnh gốc không cắt
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = currentImage;
    cropStart = cropEnd = null;
    return;
  }

  const baseImg = new Image();
  baseImg.onload = () => {
    // canvas tạm để cắt
    const tempCanvas = document.createElement("canvas");
    const tctx = tempCanvas.getContext("2d");
    tempCanvas.width = w;
    tempCanvas.height = h;

    // cắt vùng (x, y, w, h) từ ảnh gốc
    tctx.drawImage(baseImg, x, y, w, h, 0, 0, w, h);

    // resize canvas chính theo vùng cắt
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(tempCanvas, 0, 0);

    currentImage = canvas.toDataURL("image/png");
    if (!originalImage) {
      originalImage = currentImage;
    }
    pushUndoState();
    updatePlaceholder(false);

    cropStart = cropEnd = null;
  };
  baseImg.src = currentImage;
}

/* --------- Ảnh gốc & xóa --------- */

function showOriginal() {
  if (!originalImage) return;
  loadImageToCanvas(originalImage);
}

function clearCurrentImage() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  currentImage = null;
  originalImage = null;
  undoStack = [];
  redoStack = [];
  updatePlaceholder(true);
}

/* --------- Download & Gallery --------- */

function downloadImage(format) {
  if (!currentImage) return;

  let mime = "image/png";
  let ext = "png";
  if (format === "jpeg") {
    mime = "image/jpeg";
    ext = "jpg";
  }

  const link = document.createElement("a");
  link.download = `photo-editor-${Date.now()}.${ext}`;
  link.href = canvas.toDataURL(mime);
  link.click();

  // lưu vào gallery
  addToGallery(canvas.toDataURL("image/png"));
}

function addToGallery(dataUrl) {
  const gallery = document.getElementById("gallery");
  const wrapper = document.createElement("div");
  wrapper.className = "gallery-item";

  const img = document.createElement("img");
  img.src = dataUrl;
  img.addEventListener("click", () => {
    loadImageToCanvas(dataUrl);
  });

  const btnDel = document.createElement("button");
  btnDel.className = "delete-thumb";
  btnDel.textContent = "×";
  btnDel.addEventListener("click", (e) => {
    e.stopPropagation();
    gallery.removeChild(wrapper);
    // nếu không còn ảnh trong gallery và canvas đang trống -> về mặc định
    if (!gallery.children.length && !currentImage) {
      updatePlaceholder(true);
    }
  });

  wrapper.appendChild(img);
  wrapper.appendChild(btnDel);
  gallery.appendChild(wrapper);
}

/* --------- Blur background bằng API Flask (GrabCut) --------- */

async function blurBackgroundAI() {
  if (!currentImage) return;
  try {
    const res = await fetch("/api/blur-background", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: currentImage })
    });
    const data = await res.json();

    if (data.image) {
      loadImageToCanvas(data.image);
    } else {
      alert(data.error || "Không làm mờ background được.");
    }
  } catch (err) {
    alert("Lỗi blur background: " + err);
  }
}

/* --------- Đổi background màu đơn ---------- */

async function changeBackgroundColor() {
  if (!currentImage) return;

  const picker = document.getElementById("bg-color-picker");
  const color = picker ? picker.value || "#1a1c28" : "#1a1c28";

  try {
    const res = await fetch("/api/change-background", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: currentImage,
        bg_color: color
      })
    });
    const data = await res.json();

    if (data.image) {
      loadImageToCanvas(data.image);
    } else if (data.error) {
      alert("Lỗi đổi background: " + data.error);
    }
  } catch (err) {
    alert("Lỗi đổi background: " + err);
  }
}

/* --------- Xóa nền -> PNG trong suốt ---------- */

async function removeBackgroundAI() {
  if (!currentImage) return;

  try {
    const res = await fetch("/api/remove-background", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: currentImage })
    });
    const data = await res.json();

    if (data.image) {
      // data.image là PNG có alpha, khi vẽ lên canvas và tải xuống sẽ là ảnh trong suốt
      loadImageToCanvas(data.image);
    } else if (data.error) {
      alert("Lỗi xóa nền: " + data.error);
    }
  } catch (err) {
    alert("Lỗi xóa nền: " + err);
  }
}

/* --------- Tone màu (mùa hè / rừng xanh / hoàng hôn) --------- */

function applyTone(type) {
  if (type === "summer") return applySummerTone();
  if (type === "forest") return applyForestTone();
  if (type === "sunset") return applySunsetTone();
  // none hoặc không hợp lệ thì bỏ qua
}

function applyToneWithFunction(fn) {
  if (!currentImage) return;

  const img = new Image();
  img.onload = () => {
    setCanvasSizeToImage(img);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const { nr, ng, nb } = fn(r, g, b);

      data[i]     = Math.max(0, Math.min(255, nr));
      data[i + 1] = Math.max(0, Math.min(255, ng));
      data[i + 2] = Math.max(0, Math.min(255, nb));
    }

    ctx.putImageData(imageData, 0, 0);
    currentImage = canvas.toDataURL("image/png");
    pushUndoState();
    updatePlaceholder(false);
  };
  img.src = currentImage;
}

// Tone mùa hè: ấm, sáng, hơi tăng contrast
function applySummerTone() {
  applyToneWithFunction((r, g, b) => {
    r = r * 1.08 + 10;
    g = g * 1.06 + 6;
    b = b * 0.98 + 2;

    r = r * 1.07 + 5;
    g = g * 1.03;
    b = b * 0.95 - 4;

    return { nr: r, ng: g, nb: b };
  });
}

// Tone rừng xanh: tăng xanh lá, hơi lạnh, tối nhẹ
function applyForestTone() {
  applyToneWithFunction((r, g, b) => {
    r = r * 0.95;
    g = g * 1.12 + 5;
    b = b * 0.95;

    r = r * 0.97;
    g = g * 0.97;
    b = b * 0.97;

    return { nr: r, ng: g, nb: b };
  });
}

// Tone hoàng hôn: ấm, đỏ/cam nhiều, bớt xanh dương
function applySunsetTone() {
  applyToneWithFunction((r, g, b) => {
    r = r * 1.18 + 12;
    g = g * 1.05 + 4;
    b = b * 0.85;

    const cr = (r - 128) * 1.05 + 128;
    const cg = (g - 128) * 1.03 + 128;
    const cb = (b - 128) * 1.02 + 128;

    return { nr: cr, ng: cg, nb: cb };
  });
}

/* --------- Init --------- */

document.addEventListener("DOMContentLoaded", initEditor);
