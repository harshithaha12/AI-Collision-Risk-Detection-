from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import pickle
import numpy as np
import time
import os

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), '..', 'frontend')

app = Flask(__name__, static_folder=None)
CORS(app, resources={r"/*": {"origins": "*"}})

model = pickle.load(open(os.path.join(os.path.dirname(__file__), 'model.pkl'), "rb"))


# ── SERVE FRONTEND ──────────────────────────────────────────────
@app.route('/')
def serve_index():
    return send_from_directory(FRONTEND_DIR, 'index.html')

@app.route('/<path:filename>')
def serve_static(filename):
    return send_from_directory(FRONTEND_DIR, filename)

FEATURES = [
    "speed_ego", "speed_other", "distance",
    "relative_speed", "lane_difference", "weather", "brake_event"
]

history = []


@app.route("/predict", methods=["POST"])
def predict():
    data = request.json
    features = np.array([[
        data["speed_ego"],
        data["speed_other"],
        data["distance"],
        data["relative_speed"],
        data["lane_difference"],
        data["weather"],
        data["brake_event"]
    ]])
    risk = float(model.predict(features)[0])
    risk = max(0.0, min(1.0, round(risk, 4)))
    history.append({
        "distance": data["distance"],
        "risk": risk,
        "timestamp": time.time(),
        "car_id": data.get("car_id", 0)
    })
    return jsonify({"risk": risk})


@app.route("/history", methods=["GET"])
def get_history():
    return jsonify(history[-60:])


@app.route("/feature_importance", methods=["GET"])
def feature_importance():
    return jsonify({
        "features": FEATURES,
        "importances": model.feature_importances_.tolist()
    })


@app.route("/reset", methods=["POST"])
def reset():
    history.clear()
    return jsonify({"status": "ok"})


@app.route("/status", methods=["GET"])
def status():
    return jsonify({"status": "ok", "predictions": len(history)})


if __name__ == "__main__":
    app.run(debug=True, port=5000)