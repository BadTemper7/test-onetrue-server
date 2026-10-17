// Seed manually with: npm run seed. Do not seed during API startup.
require("dotenv").config();

const dns = require("dns");

// Force a public DNS resolver to avoid "querySrv ECONNREFUSED" / querySrv ENOTFOUND
// errors that occur when the host's default resolver can't resolve MongoDB
// Atlas SRV records. This must run before mongoose.connect().
// Override with DNS_SERVERS="1.1.1.1,8.8.8.8" in your environment if needed.
const dnsServers = String(process.env.DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

try {
  dns.setServers(dnsServers);
  console.log(`🌐 DNS servers set to: ${dnsServers.join(", ")}`);
} catch (dnsError) {
  console.warn(`⚠️  Could not set custom DNS servers: ${dnsError.message}`);
}

const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const {
  ensureDocumentsRoot,
  getDocumentsStorageStatus,
  DOCUMENTS_ROOT,
} = require("./utils/localFileStorage.js");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Local document storage. Client folders are created automatically on upload.
// Storage is initialized again during server bootstrap before accepting requests.
// Documents must not be exposed through express.static.
// Configure DOCUMENTS_DIR outside the web root; document access requires separate authorization.

// MongoDB Connection
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/testdb";

// ==================== MODELS ====================

// User Schema
const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  age: {
    type: Number,
    min: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const User = mongoose.model("TestUser", userSchema);

// ==================== ROUTES ====================

// Health Check (Important for Hostinger)
app.get("/", (req, res) => {
  res.json({
    status: "OK",
    message: "🚀 Server is running successfully!",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Health check endpoint
app.get("/health", async (req, res) => {
  const documentStorage = await getDocumentsStorageStatus();
  const databaseConnected = mongoose.connection.readyState === 1;
  const healthy = databaseConnected && documentStorage.ready;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "degraded",
    mongodb: databaseConnected ? "connected" : "disconnected",
    documentStorage,
    uptime: process.uptime(),
  });
});

// ===== User Routes =====

// Create a new user
app.post("/api/users", async (req, res) => {
  try {
    const { name, email, age } = req.body;

    // Validation
    if (!name || !email) {
      return res.status(400).json({
        error: "Name and email are required",
      });
    }

    const user = new User({ name, email, age });
    await user.save();

    res.status(201).json({
      success: true,
      message: "User created successfully",
      user,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        error: "Email already exists",
      });
    }
    res.status(500).json({
      error: error.message,
    });
  }
});

// Get all users
app.get("/api/users", async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json({
      success: true,
      count: users.length,
      users,
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

// Get a single user by ID
app.get("/api/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }
    res.json({
      success: true,
      user,
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

// Update a user
app.put("/api/users/:id", async (req, res) => {
  try {
    const { name, email, age } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name, email, age },
      { new: true, runValidators: true },
    );

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    res.json({
      success: true,
      message: "User updated successfully",
      user,
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

// Delete a user
app.delete("/api/users/:id", async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }
    res.json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

// ===== Test Route =====
app.get("/api/test", (req, res) => {
  res.json({
    message: "API is working!",
    endpoints: [
      { method: "GET", path: "/" },
      { method: "GET", path: "/health" },
      { method: "GET", path: "/api/users" },
      { method: "POST", path: "/api/users" },
      { method: "GET", path: "/api/users/:id" },
      { method: "PUT", path: "/api/users/:id" },
      { method: "DELETE", path: "/api/users/:id" },
      { method: "GET", path: "/api/test" },
    ],
  });
});

// ==================== ONETRUE BACKEND ====================
// OneTrue folders are kept directly in the project root.
// The OneTrue API and Socket.IO share the same HTTP server.
const authRoutes = require("./routes/authRoutes.js").default;
const adminRoutes = require("./routes/adminRoutes.js").default;
const clientRoutes = require("./routes/clientRoutes.js").default;
const {
  getPublicBookingByNumber,
} = require("./controllers/bookingController.js");
const asyncHandler = require("./utils/asyncHandler.js").default;

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/client", clientRoutes);

app.get(
  "/api/bookings/status/:bookingNumber",
  asyncHandler(getPublicBookingByNumber),
);
app.get(
  "/api/public/bookings/:bookingNumber",
  asyncHandler(getPublicBookingByNumber),
);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
  });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error("Error:", err.stack);
  res.status(500).json({
    error: "Something went wrong!",
    message: err.message,
  });
});

// Start HTTP and Socket.IO server
const { initSocket } = require("./socket/socket.js");
const httpServer = http.createServer(app);
const socketAllowedOrigins = String(
  process.env.SOCKET_ALLOWED_ORIGINS || process.env.CORS_ORIGINS || "",
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

initSocket(httpServer, socketAllowedOrigins);

const startServer = async () => {
  const storagePath = await ensureDocumentsRoot();
  console.log(`📁 Document storage ready: ${storagePath}`);

  await mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log("✅ Connected to MongoDB successfully!");

  // MongoDB cannot maintain a compound multikey index that includes two
  // array fields. Older deployments created an index containing both
  // `clients` and `transactions.transactionKey`, which causes inserts such as
  // a Special Rate with multiple clients/transactions to fail with:
  // "cannot index parallel arrays [clients] [transactions]".
  //
  // Remove only that legacy invalid index. The schema now keeps two safe
  // indexes instead: one starting with `clients`, and another starting with
  // `transactions.transactionKey`.
  try {
    const specialRatesCollection =
      mongoose.connection.collection("specialrates");
    const indexes = await specialRatesCollection.indexes();

    for (const index of indexes) {
      const keys = index?.key || {};
      if (
        keys.clients !== undefined &&
        keys["transactions.transactionKey"] !== undefined
      ) {
        await specialRatesCollection.dropIndex(index.name);
        console.log(`✅ Removed legacy Special Rate index: ${index.name}`);
      }
    }
  } catch (indexError) {
    // NamespaceNotFound simply means the collection has not been created yet.
    // Do not prevent the API from starting for that case.
    if (
      indexError?.codeName !== "NamespaceNotFound" &&
      indexError?.code !== 26
    ) {
      throw indexError;
    }
  }

  httpServer.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`🔗 Test the API: http://localhost:${PORT}/api/test`);
    console.log("🔌 Socket.IO is enabled");
  });
};

startServer().catch((error) => {
  console.error("❌ Server startup failed:", error.message);
  if (error?.stack) console.error(error.stack);
  process.exit(1);
});
