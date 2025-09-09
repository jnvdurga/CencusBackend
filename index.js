import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import gdal from "gdal-async";

// ------------------ Fix __dirname ------------------ //
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Enable CORS with specific origins
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      "https://census-frontend-ttbh-git-main-jnvdurgas-projects.vercel.app"
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.use(express.json());

// ------------------ Helper function to read features from layer ------------------ //
function readFeaturesFromLayer(layer) {
  const features = [];
  layer.features.forEach((feature) => {
    features.push({
      type: "Feature",
      properties: feature.fields.toObject(),
      geometry: JSON.parse(feature.getGeometry().toJSON()),
    });
  });
  return features;
}

// ------------------ Preload Departments ------------------ //
const departmentFile = path.join(__dirname, "./department.gpkg");
let departmentsGeoJSON = null;

try {
  const departmentDb = gdal.open(departmentFile);
  const deptLayer = departmentDb.layers.get(0);
  const features = readFeaturesFromLayer(deptLayer);
  departmentsGeoJSON = { type: "FeatureCollection", features };
  console.log("✅ Departments preloaded");
  departmentDb.close();
} catch (err) {
  console.error("❌ Failed to load Department.gpkg:", err);
}

// ------------------ Preload Municipalities ------------------ //
const municipalityCache = new Map();
const dataDir = path.join(__dirname, "data");

fs.readdirSync(dataDir).forEach(file => {
  if (file.endsWith(".gpkg")) {
    const departmentCode = file.match(/\d+/)[0]; // extract code from filename
    try {
      const muniDb = gdal.open(path.join(dataDir, file));
      const layer = muniDb.layers.get(0);
      const features = readFeaturesFromLayer(layer);
      municipalityCache.set(departmentCode, { type: "FeatureCollection", features });
      console.log(`✅ Preloaded municipalities for department ${departmentCode}`);
      muniDb.close();
    } catch (err) {
      console.error(`❌ Failed to preload ${file}:`, err);
    }
  }
});

// ------------------ Departments Endpoint ------------------ //
app.get("/api/departments", (req, res) => {
  if (!departmentsGeoJSON) {
    return res.status(500).json({ error: "Departments data not available" });
  }
  res.json(departmentsGeoJSON);
});

// ------------------ Municipalities Endpoint ------------------ //
app.get("/api/municipalities/:departmentCode", (req, res) => {
  const { departmentCode } = req.params;
  const data = municipalityCache.get(departmentCode);
  if (data) {
    return res.json(data);
  } else {
    return res.status(404).json({ error: "Municipality data not found" });
  }
});

// ------------------ Clear Cache Endpoint (for development) ------------------ //
app.delete("/api/cache", (req, res) => {
  departmentsGeoJSON = null;
  municipalityCache.clear();
  res.json({ message: "Cache cleared" });
});

// ------------------ Start Server ------------------ //
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📍 Departments: http://localhost:${PORT}/api/departments`);
  console.log(`📍 Municipalities (example): http://localhost:${PORT}/api/municipalities/05`);
  console.log(`📍 Clear cache: http://localhost:${PORT}/api/cache`);
});
