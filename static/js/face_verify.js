let video = null;
let canvas = null;
let ctx = null;
let stream = null;

function initFaceVerify() {
  video = document.getElementById("video");
  canvas = document.getElementById("faceCanvas");
  ctx = canvas.getContext("2d");

  document.getElementById("btn-start-camera").addEventListener("click", startCamera);
  document.getElementById("btn-stop-camera").addEventListener("click", stopCamera);
  document.getElementById("btn-capture-reference").addEventListener("click", captureReference);
  document.getElementById("btn-check-face").addEventListener("click", checkFace);
}

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    document.getElementById("face-message").textContent = "";
  } catch (err) {
    document.getElementById("face-message").textContent = "Không mở được camera: " + err;
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  if (video) {
    video.srcObject = null;
  }
}

function captureSnapshot() {
  if (!video || !stream) {
    document.getElementById("face-message").textContent = "Hãy bật camera trước.";
    return null;
  }
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

async function captureReference() {
  const snapshot = captureSnapshot();
  if (!snapshot) return;

  try {
    const res = await fetch("/api/save-face-reference", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: snapshot })
    });
    const data = await res.json();
    document.getElementById("face-message").textContent = data.message || "";
  } catch (err) {
    document.getElementById("face-message").textContent = "Lỗi: " + err;
  }
}

async function checkFace() {
  const snapshot = captureSnapshot();
  if (!snapshot) return;

  document.getElementById("verify-status").textContent = "Trạng thái: Đang kiểm tra...";

  try {
    const res = await fetch("/api/verify-face", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: snapshot })
    });
    const data = await res.json();
    document.getElementById("face-message").textContent = data.message || "";

    if (data.username === "unknown" || !data.success) {
      document.getElementById("verify-status").textContent = "Trạng thái: Kết quả - unknown";
    } else {
      document.getElementById("verify-status").textContent = "Trạng thái: Xác minh - " + data.username;
      // chuyển sang trang editor
      setTimeout(() => {
        window.location.href = "/editor";
      }, 800);
    }
  } catch (err) {
    document.getElementById("face-message").textContent = "Lỗi: " + err;
    document.getElementById("verify-status").textContent = "Trạng thái: Lỗi";
  }
}

document.addEventListener("DOMContentLoaded", initFaceVerify);
