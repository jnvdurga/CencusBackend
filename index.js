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

// ------------------ Cache for GeoJSON data ------------------ //
const cache = {
  departments: null,
  municipalities: new Map(),
  lastUpdated: null
};

// Cache expiration time (5 minutes)
const CACHE_EXPIRY = 5 * 60 * 1000;

// ------------------ Department GPKG (local) ------------------ //
const departmentFile = path.join(__dirname, "./department.gpkg");
let departmentDb;

try {
  departmentDb = gdal.open(departmentFile);
  console.log("✅ Department.gpkg loaded");
} catch (err) {
  console.error("❌ Failed to load Department.gpkg:", err);
}

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

// ------------------ Departments Endpoint (with caching) ------------------ //
app.get("/api/departments", (req, res) => {
  if (cache.departments && cache.lastUpdated && (Date.now() - cache.lastUpdated) < CACHE_EXPIRY) {
    console.log("✅ Serving departments from cache");
    return res.json(cache.departments);
  }

  try {
    const deptLayer = departmentDb.layers.get(0);
    const features = readFeaturesFromLayer(deptLayer);

    cache.departments = { type: "FeatureCollection", features };
    cache.lastUpdated = Date.now();

    console.log("✅ Departments data cached");
    res.json(cache.departments);
  } catch (err) {
    console.error("❌ Error reading departments:", err);
    res.status(500).json({ error: "Failed to read departments" });
  }
});

// ------------------ Municipalities Endpoint (with caching) ------------------ //
app.get("/api/municipalities/:departmentCode", (req, res) => {
  const { departmentCode } = req.params;

  // Check cache
  if (cache.municipalities.has(departmentCode)) {
    const cachedData = cache.municipalities.get(departmentCode);
    if (Date.now() - cachedData.timestamp < CACHE_EXPIRY) {
      console.log(`✅ Serving municipalities for ${departmentCode} from cache`);
      return res.json(cachedData.data);
    }
  }

  try {
    const muniFile = path.join(__dirname, "data", `DPTO_CCDGO_${departmentCode}.gpkg`);

    if (!fs.existsSync(muniFile)) {
      return res.status(404).json({ error: "Municipality data not found for this department" });
    }

    const muniDb = gdal.open(muniFile);
    const muniLayer = muniDb.layers.get(0);
    const features = readFeaturesFromLayer(muniLayer);

    // Cache the result
    cache.municipalities.set(departmentCode, {
      data: { type: "FeatureCollection", features },
      timestamp: Date.now()
    });

    res.json({ type: "FeatureCollection", features });

    muniDb.close();
  } catch (err) {
    console.error("❌ Municipality error:", err);
    res.status(500).json({ error: "Failed to read municipality data", details: err.message });
  }
});

// ------------------ Clear cache endpoint (for development) ------------------ //
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
  console.log(`📍 Municipalities: http://localhost:${PORT}/api/municipalities/05`);
  console.log(`📍 Clear cache: http://localhost:${PORT}/api/cache`);
});
