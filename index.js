import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import gdal from "gdal-async";
import fetch from "node-fetch"; // ✅ required for downloading from Supabase

// ------------------ Fix __dirname ------------------ //
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;


app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      "https://census-frontend-ttbh-git-main-jnvdurgas-projects.vercel.app" // <-- Vercel frontend
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.use(express.json());

// ------------------ Department GPKG (local) ------------------ //
const departmentFile = path.join(__dirname, "./department.gpkg");
let departmentDb;

try {
  departmentDb = gdal.open(departmentFile);
  console.log("✅ Department.gpkg loaded");
} catch (err) {
  console.error("❌ Failed to load Department.gpkg:", err);
}

// ------------------ Departments Endpoint ------------------ //
app.get("/api/departments", (req, res) => {
  try {
    const deptLayer = departmentDb.layers.get(0); // first layer
    const features = [];

    deptLayer.features.forEach((feature) => {
      features.push({
        type: "Feature",
        properties: feature.fields.toObject(),
        geometry: JSON.parse(feature.getGeometry().toJSON()),
      });
    });

    res.json({ type: "FeatureCollection", features });
  } catch (err) {
    console.error("❌ Error reading departments:", err);
    res.status(500).json({ error: "Failed to read departments" });
  }
});

// ------------------ Municipalities Endpoint ------------------ //
// ------------------ Municipalities Endpoint ------------------ //
app.get("/api/municipalities/:departmentCode", async (req, res) => {
  const { departmentCode } = req.params;

  // 🔹 Build dynamic Supabase URL (match your naming scheme)
  const municipalityUrl = `https://hpsloblhlcykngehwzet.supabase.co/storage/v1/object/public/gpkgfiles/DPTO_CCDGO_${departmentCode}.gpkg`;

  try {
    const tempPath = path.join(__dirname, `tmp_municipality_${departmentCode}.gpkg`);

    // 🔹 Download from Supabase
    const response = await fetch(municipalityUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch Municipality.gpkg: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(tempPath, buffer);

    // 🔹 Open with gdal
    const muniDb = gdal.open(tempPath);
    const muniLayer = muniDb.layers.get(0);
    const features = [];

    muniLayer.features.forEach((feature) => {
      features.push({
        type: "Feature",
        properties: feature.fields.toObject(),
        geometry: JSON.parse(feature.getGeometry().toJSON()),
      });
    });

    res.json({ type: "FeatureCollection", features });

    muniDb.close();
    fs.unlinkSync(tempPath); // ✅ clean temp file
  } catch (err) {
    console.error("❌ Municipality error:", err);
    res.status(500).json({ error: "Failed to read municipality data", details: err.message });
  }
});

// ------------------ Start Server ------------------ //
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📍 Departments: http://localhost:${PORT}/api/departments`);
  console.log(`📍 Municipalities: http://localhost:${PORT}/api/municipalities/05`);
});
