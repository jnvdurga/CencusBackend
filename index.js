import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import gdal from "gdal-async";
import compression from "compression";

// ------------------ Fix __dirname ------------------ //
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Enable CORS
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

// Enable gzip compression
app.use(compression());

app.use(express.json());

// ------------------ Cache ------------------ //
const cache = {
  departments: null,
  municipalities: new Map(),
  lastUpdated: null,
};
const CACHE_EXPIRY = 5 * 60 * 1000; // 5 minutes

// ------------------ Helper: Read features ------------------ //
function readFeaturesFromLayer(layer) {
  const features = [];
  let feature;
  const iterator = layer.features;
  while ((feature = iterator.next())) {
    features.push({
      type: "Feature",
      properties: feature.fields.toObject(),
      geometry: JSON.parse(feature.getGeometry().toJSON()),
    });
  }
  return features;
}

// ------------------ Preload Departments ------------------ //
const departmentFile = path.join(__dirname, "./department.gpkg");
let departmentDb;

try {
  departmentDb = gdal.open(departmentFile);
  const deptLayer = departmentDb.layers.get(0);
  const features = readFeaturesFromLayer(deptLayer);
  cache.departments = { type: "FeatureCollection", features };
  cache.lastUpdated = Date.now();
  console.log("✅ Departments preloaded");
  departmentDb.close();
} catch (err) {
  console.error("❌ Failed to load Department.gpkg:", err);
}

// ------------------ Departments endpoint ------------------ //
app.get("/api/departments", (req, res) => {
  if (!cache.departments) return res.status(500).json({ error: "Departments data not available" });
  res.json(cache.departments);
});

// ------------------ Municipalities endpoint (lazy loading + memory cache) ------------------ //
app.get("/api/municipalities/:departmentCode", (req, res) => {
  const { departmentCode } = req.params;

  // Serve from cache if available and valid
  const cached = cache.municipalities.get(departmentCode);
  if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY) {
    return res.json(cached.data);
  }

  // Lazy load GPKG
  try {
    const muniFile = path.join(__dirname, "data", `DPTO_CCDGO_${departmentCode}.gpkg`);
    if (!fs.existsSync(muniFile)) return res.status(404).json({ error: "Municipality data not found" });

    const muniDb = gdal.open(muniFile);
    const layer = muniDb.layers.get(0);
    const features = readFeaturesFromLayer(layer);
    muniDb.close();

    const geojson = { type: "FeatureCollection", features };
    cache.municipalities.set(departmentCode, { data: geojson, timestamp: Date.now() });

    res.json(geojson);
  } catch (err) {
    console.error("❌ Municipality error:", err);
    res.status(500).json({ error: "Failed to read municipality data", details: err.message });
  }
});

// ------------------ Clear cache ------------------ //
app.delete("/api/cache", (req, res) => {
  cache.departments = null;
  cache.municipalities.clear();
  cache.lastUpdated = null;
  res.json({ message: "Cache cleared" });
});

// ------------------ Start Server ------------------ //
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📍 Departments: http://localhost:${PORT}/api/departments`);
  console.log(`📍 Municipalities example: http://localhost:${PORT}/api/municipalities/05`);
  console.log(`📍 Clear cache: http://localhost:${PORT}/api/cache`);
});
