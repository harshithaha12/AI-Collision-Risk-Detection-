import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor
import pickle

# Load dataset
df = pd.read_csv("v2v_collision_probability_dataset.csv")

features = [
    "speed_ego",
    "speed_other",
    "distance",
    "relative_speed",
    "lane_difference",
    "weather",
    "brake_event"
]

target = "collision_risk"

X = df[features]
y = df[target]

# Split
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42
)

# 🔥 REGRESSION MODEL
model = RandomForestRegressor(n_estimators=100)

model.fit(X_train, y_train)

# Accuracy (R² score)
print("Model Score (R²):", model.score(X_test, y_test))

# Save model
with open("model.pkl", "wb") as f:
    pickle.dump(model, f)

print("✅ Regression model trained successfully!")