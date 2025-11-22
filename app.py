from flask import Flask, render_template, request, redirect, url_for, session, jsonify
import os
import cv2
import numpy as np
import base64

app = Flask(__name__)
app.secret_key = "super-secret-key"

# Thư mục lưu ảnh khuôn mặt
IMG_CHECK_DIR = "imgcheck"
os.makedirs(IMG_CHECK_DIR, exist_ok=True)

# Thư mục emoji
EMOJI_FILES = {
    "smile": "static/emojis/smile.png",
    "heart": "static/emojis/heart.png",
    "star": "static/emojis/star.png",
    "cool": "static/emojis/cool.png"
}

# Haarcascade
FACE_CASCADE_PATH = "haarcascade_frontalface_default.xml"
face_cascade = cv2.CascadeClassifier(FACE_CASCADE_PATH)

# User tạm thời (chỉ lưu trong RAM)
users = {
    "minhnhat": "minhnhat"
}


# -------------------------------------------------
# Helper: chuyển qua lại dataURL <-> OpenCV image
# -------------------------------------------------
def dataurl_to_cv2_img(data_url):
    """
    Chuyển dataURL base64 từ JS sang ảnh OpenCV (BGR).

    Hàm này xử lý được cả ảnh 3 kênh (BGR) lẫn 4 kênh (BGRA) –
    nếu là BGRA thì convert về BGR để dùng cho OpenCV / GrabCut.
    """
    if not data_url or "," not in data_url:
        return None

    header, encoded = data_url.split(',', 1)
    data = base64.b64decode(encoded)
    nparr = np.frombuffer(data, np.uint8)

    # Đọc với IMREAD_UNCHANGED để không mất alpha (nếu có)
    img = cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED)
    if img is None:
        return None

    # Nếu ảnh có alpha (4 kênh) thì chuyển về BGR
    if len(img.shape) == 3 and img.shape[2] == 4:
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)

    return img


def cv2_img_to_dataurl(img):
    """
    Chuyển ảnh OpenCV (BGR hoặc BGRA) sang dataURL base64 (PNG).
    Dùng cho tất cả API trả ảnh về JS.
    """
    if img is None:
        raise ValueError("Image is None")

    success, buffer = cv2.imencode('.png', img)
    if not success:
        raise ValueError("Encode image failed")
    b64 = base64.b64encode(buffer).decode('utf-8')
    return 'data:image/png;base64,' + b64


def get_username_from_filename(filename):
    # imgcheck/minhnhat.png -> minhnhat
    name = os.path.splitext(os.path.basename(filename))[0]
    return name


def build_face_mask(img, faces, expand_x=0.5, expand_y=0.8):
    """
    Từ danh sách bounding box khuôn mặt -> tạo mask (255 = vùng giữ lại, 0 = background)
    (Hiện chưa dùng trực tiếp nhưng để sẵn nếu cần.)
    """
    h, w = img.shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)

    for (x, y, fw, fh) in faces:
        px = int(fw * expand_x)
        py = int(fh * expand_y)
        x1 = max(0, x - px)
        y1 = max(0, y - py)
        x2 = min(w, x + fw + px)
        y2 = min(h, y + fh + py)
        mask[y1:y2, x1:x2] = 255

    return mask


def hex_to_bgr(hex_color):
    """
    '#RRGGBB' -> (B, G, R) cho OpenCV
    """
    if not isinstance(hex_color, str):
        return (255, 255, 255)
    hex_color = hex_color.lstrip('#')
    if len(hex_color) != 6:
        return (255, 255, 255)
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    return (b, g, r)


def grabcut_person_mask(img, faces=None):
    """
    Sử dụng GrabCut để tách người/vật chính khỏi nền.
    - Nếu có danh sách face (x, y, w, h) thì dùng làm vùng foreground.
    - Nếu không, lấy 1 hình chữ nhật ở giữa ảnh.

    Trả về mask 0/255 (255 = foreground).
    """
    h, w = img.shape[:2]

    # Đảm bảo ảnh là 3 kênh BGR cho GrabCut
    if len(img.shape) == 2:
        img_for_gc = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        img_for_gc = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
    else:
        img_for_gc = img.copy()

    mask = np.zeros((h, w), np.uint8)
    bgModel = np.zeros((1, 65), np.float64)
    fgModel = np.zeros((1, 65), np.float64)

    if faces is not None and len(faces) > 0:
        xs, ys, x2s, y2s = [], [], [], []
        for (x, y, fw, fh) in faces:
            xs.append(x)
            ys.append(y)
            x2s.append(x + fw)
            y2s.append(y + fh)

        x_min = max(0, min(xs))
        y_min = max(0, min(ys))
        x_max = min(w - 1, max(x2s))
        y_max = min(h - 1, max(y2s))

        pad_x = int(0.4 * (x_max - x_min + 1))
        pad_y = int(0.8 * (y_max - y_min + 1))

        x1 = max(0, x_min - pad_x)
        y1 = max(0, y_min - pad_y)
        x2 = min(w - 1, x_max + pad_x)
        y2 = min(h - 1, y_max + pad_y)

        rect = (x1, y1, x2 - x1, y2 - y1)
    else:
        rect = (int(w * 0.2), int(h * 0.15), int(w * 0.6), int(h * 0.7))

    try:
        cv2.grabCut(img_for_gc, mask, rect, bgModel, fgModel, 5, cv2.GC_INIT_WITH_RECT)
    except Exception:
        # Nếu GrabCut lỗi -> coi toàn bộ là foreground
        mask[:, :] = 255
        return mask

    mask2 = np.where(
        (mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD),
        255,
        0
    ).astype('uint8')

    return mask2


# -------------------------------------------------
# Routes chính
# -------------------------------------------------
@app.route("/")
def index():
    return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login():
    message = ""
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").strip()
        if username in users and users[username] == password:
            session["username"] = username
            session.pop("verified_user", None)
            return redirect(url_for("face_verify"))
        else:
            message = "Sai tài khoản hoặc mật khẩu!"
    return render_template("login.html", message=message)


@app.route("/register", methods=["GET", "POST"])
def register():
    message = ""
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").strip()
        if not username or not password:
            message = "Vui lòng nhập đầy đủ."
        elif username in users:
            message = "Tài khoản đã tồn tại."
        else:
            users[username] = password
            message = "Đăng ký thành công! Hãy đăng nhập."
    return render_template("register.html", message=message)


@app.route("/forgot", methods=["GET", "POST"])
def forgot():
    info = ""
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        if username == "minhnhat":
            info = "Mật khẩu mặc định của 'minhnhat' là 'minhnhat'."
        else:
            info = "Hãy liên hệ quản trị viên để đặt lại mật khẩu."
    return render_template("forgot.html", info=info)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/face-verify")
def face_verify():
    if "username" not in session:
        return redirect(url_for("login"))
    return render_template("face_verify.html", username=session["username"])


@app.route("/editor")
def editor():
    if "verified_user" not in session:
        return redirect(url_for("face_verify"))
    return render_template("editor.html", username=session["verified_user"])


# -------------------------------------------------
# API cho xác minh khuôn mặt
# -------------------------------------------------
@app.route("/api/save-face-reference", methods=["POST"])
def save_face_reference():
    if "username" not in session:
        return jsonify({"success": False, "message": "Chưa đăng nhập."}), 401

    data = request.get_json()
    img_data = data.get("image")
    username = session["username"]

    img = dataurl_to_cv2_img(img_data)
    if img is None:
        return jsonify({"success": False, "message": "Ảnh không hợp lệ."})

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, 1.3, 5)

    if len(faces) == 0:
        return jsonify({"success": False, "message": "Không phát hiện khuôn mặt."})

    # Cắt lấy vùng mặt lớn nhất
    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
    face_img = img[y:y + h, x:x + w]

    save_path = os.path.join(IMG_CHECK_DIR, f"{username}.png")
    cv2.imwrite(save_path, face_img)

    return jsonify({"success": True, "message": "Đã lưu ảnh khuôn mặt!"})


@app.route("/api/verify-face", methods=["POST"])
def verify_face():
    if "username" not in session:
        return jsonify({"success": False, "message": "Chưa đăng nhập."}), 401

    data = request.get_json()
    img_data = data.get("image")
    target_img = dataurl_to_cv2_img(img_data)
    if target_img is None:
        return jsonify({"success": False, "username": "unknown",
                        "message": "Ảnh không hợp lệ."})

    gray_target = cv2.cvtColor(target_img, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray_target, 1.3, 5)

    if len(faces) == 0:
        return jsonify({"success": False, "username": "unknown",
                        "message": "Không phát hiện khuôn mặt."})

    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
    target_face = gray_target[y:y + h, x:x + w]

    best_user = "unknown"
    best_score = -1

    for fname in os.listdir(IMG_CHECK_DIR):
        path = os.path.join(IMG_CHECK_DIR, fname)
        ref_img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        if ref_img is None:
            continue

        ref_face = cv2.resize(ref_img, (target_face.shape[1], target_face.shape[0]))
        hist_target = cv2.calcHist([target_face], [0], None, [256], [0, 256])
        hist_ref = cv2.calcHist([ref_face], [0], None, [256], [0, 256])
        cv2.normalize(hist_target, hist_target)
        cv2.normalize(hist_ref, hist_ref)

        score = cv2.compareHist(hist_target, hist_ref, cv2.HISTCMP_CORREL)
        if score > best_score:
            best_score = score
            best_user = get_username_from_filename(fname)

    if best_score < 0.7:
        best_user = "unknown"

    if best_user != "unknown":
        session["verified_user"] = best_user
        return jsonify({"success": True, "username": best_user,
                        "message": "Xác minh thành công!"})
    else:
        return jsonify({"success": False, "username": "unknown",
                        "message": "Không khớp với người dùng nào."})


# -------------------------------------------------
# API blur mặt trong editor
# -------------------------------------------------
@app.route("/api/blur-face", methods=["POST"])
def api_blur_face():
    data = request.get_json()
    img_data = data.get("image")
    if not img_data:
        return jsonify({"error": "No image"}), 400

    img = dataurl_to_cv2_img(img_data)
    if img is None:
        return jsonify({"error": "Ảnh không hợp lệ"}), 400

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(60, 60)
    )

    if len(faces) == 0:
        result_dataurl = cv2_img_to_dataurl(img)
        return jsonify({"image": result_dataurl, "faces": 0})

    for (x, y, w, h) in faces:
        roi = img[y:y + h, x:x + w]
        roi = cv2.GaussianBlur(roi, (51, 51), 30)
        img[y:y + h, x:x + w] = roi

    result_dataurl = cv2_img_to_dataurl(img)
    return jsonify({"image": result_dataurl, "faces": int(len(faces))})


# -------------------------------------------------
# API che mặt bằng emoji
# -------------------------------------------------
@app.route("/api/emoji-face", methods=["POST"])
def api_emoji_face():
    data = request.get_json()
    img_data = data.get("image")
    emoji_key = data.get("emoji", "smile")

    if not img_data:
        return jsonify({"error": "No image"}), 400

    emoji_path = EMOJI_FILES.get(emoji_key)
    if not emoji_path or not os.path.exists(emoji_path):
        return jsonify({"error": "Emoji not found"}), 400

    img = dataurl_to_cv2_img(img_data)
    if img is None:
        return jsonify({"error": "Ảnh không hợp lệ"}), 400

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(60, 60)
    )

    if len(faces) == 0:
        return jsonify({"image": cv2_img_to_dataurl(img), "faces": 0})

    emoji_img = cv2.imread(emoji_path, cv2.IMREAD_UNCHANGED)
    if emoji_img is None:
        return jsonify({"error": "Cannot read emoji file"}), 500

    for (x, y, w, h) in faces:
        emoji_resized = cv2.resize(emoji_img, (w, h))

        if emoji_resized.shape[2] == 4:
            emoji_rgb = emoji_resized[..., :3]
            alpha = emoji_resized[..., 3] / 255.0
            alpha = alpha[..., np.newaxis]

            roi = img[y:y + h, x:x + w].astype(float)
            emoji_rgb = emoji_rgb.astype(float)

            blended = alpha * emoji_rgb + (1 - alpha) * roi
            img[y:y + h, x:x + w] = blended.astype(np.uint8)
        else:
            img[y:y + h, x:x + w] = emoji_resized

    result_dataurl = cv2_img_to_dataurl(img)
    return jsonify({"image": result_dataurl, "faces": int(len(faces))})


# -------------------------------------------------
# Background: blur / đổi / xóa nền (GrabCut)
# -------------------------------------------------
@app.route("/api/blur-background", methods=["POST"])
def api_blur_background():
    """
    Làm mờ background, giữ người rõ (tách bằng GrabCut).
    """
    data = request.get_json()
    img_data = data.get("image")
    if not img_data:
        return jsonify({"error": "No image"}), 400

    img = dataurl_to_cv2_img(img_data)
    if img is None:
        return jsonify({"error": "Ảnh không hợp lệ"}), 400

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(60, 60)
    )

    faces_list = [] if isinstance(faces, tuple) or faces is None else faces
    mask = grabcut_person_mask(img, faces_list)

    mask_3 = cv2.merge([mask, mask, mask])
    inv_mask_3 = cv2.bitwise_not(mask_3)

    blurred = cv2.GaussianBlur(img, (51, 51), 30)

    fg = cv2.bitwise_and(img, mask_3)
    bg = cv2.bitwise_and(blurred, inv_mask_3)
    result = cv2.add(fg, bg)

    result_dataurl = cv2_img_to_dataurl(result)
    return jsonify({"image": result_dataurl})


@app.route("/api/change-background", methods=["POST"])
def api_change_background():
    """
    Đổi background sang 1 màu đơn, giữ người (tách bằng GrabCut).
    """
    data = request.get_json()
    img_data = data.get("image")
    bg_color = data.get("bg_color", "#ffffff")

    if not img_data:
        return jsonify({"error": "No image"}), 400

    img = dataurl_to_cv2_img(img_data)
    if img is None:
        return jsonify({"error": "Ảnh không hợp lệ"}), 400

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(60, 60)
    )

    faces_list = [] if isinstance(faces, tuple) or faces is None else faces
    mask = grabcut_person_mask(img, faces_list)
    mask_3 = cv2.merge([mask, mask, mask])
    inv_mask_3 = cv2.bitwise_not(mask_3)

    h, w = img.shape[:2]
    bg_bgr = hex_to_bgr(bg_color)
    bg_img = np.full((h, w, 3), bg_bgr, dtype=np.uint8)

    fg = cv2.bitwise_and(img, mask_3)
    bg = cv2.bitwise_and(bg_img, inv_mask_3)
    result = cv2.add(fg, bg)

    result_dataurl = cv2_img_to_dataurl(result)
    return jsonify({"image": result_dataurl})


@app.route("/api/remove-background", methods=["POST"])
def api_remove_background():
    """
    Xóa nền: trả về ảnh PNG với alpha (foreground = opaque, background = trong suốt).
    """
    data = request.get_json()
    img_data = data.get("image")
    if not img_data:
        return jsonify({"error": "No image"}), 400

    img = dataurl_to_cv2_img(img_data)
    if img is None:
        return jsonify({"error": "Ảnh không hợp lệ"}), 400

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(60, 60)
    )

    faces_list = [] if isinstance(faces, tuple) or faces is None else faces
    mask = grabcut_person_mask(img, faces_list)  # 0 / 255

    # BGR -> BGRA
    rgba = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = mask  # alpha = mask

    result_dataurl = cv2_img_to_dataurl(rgba)
    return jsonify({"image": result_dataurl})


# -------------------------------------------------
# Main
# -------------------------------------------------
if __name__ == "__main__":
    # cài: pip install flask opencv-python numpy
    app.run(debug=True)
