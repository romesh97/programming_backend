const functions = require("firebase-functions");
const { Storage } = require("@google-cloud/storage");
const UUID = require("uuid-v4");
const express = require("express");
const cors = require("cors");
const formidable = require("formidable-serverless");
const { signInWithEmailAndPassword } = require("firebase/auth");
const { auth } = require("./firebase");

const app = express();
app.use(cors({ origin: true }));
app.use(
  cors({
    origin: ["https://zany-umbrella-xqq4w9xvr6p3v9xv-3000.app.github.dev"],
  })
);
app.use(express.json({ limit: "50mb", extended: true }));
app.use(express.urlencoded({ extended: false, limit: "50mb" }));

var admin = require("firebase-admin");

var serviceAccount = require("./admin.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const userRef = admin.firestore().collection("Pets");

const storage = new Storage({
  keyFilename: "admin.json",
});

// ----------------------------------- REGISTER ---------------------------------

app.post("/register", async (req, res) => {
  const { email, password, firstName } = req.body;

  try {
    // register user in fire Auth
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
      displayName: firstName,
    });

    const dogRef = admin.firestore().collection("Users");

    // send details to store
    await dogRef.doc(userRecord.uid).set({
      email: email,
      firstName: firstName,
    });

    res.status(200).json({
      message: "user created successfully",
      data: {
        uid: userRecord.uid,
        email: userRecord.email,
        name: userRecord.name,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: "Error creating dog user",
      error: error.message,
    });
  }
});

// ----------------------------------- LOGIN ---------------------------------

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({
      message: "Validation Error",
      error: "Email and password are required",
    });
    return;
  }

  try {
    const userCredential = await signInWithEmailAndPassword(
      auth,
      email,
      password
    );
    const user = userCredential.user;

    // Get token for user
    const idToken = await user.getIdToken();

    // validate user from auth
    const userDoc = await admin
      .firestore()
      .collection("Users")
      .doc(user.uid)
      .get();

    if (!userDoc.exists) {
      await user.delete();
      res.status(403).json({
        message: "Authorization Error",
        error: "User is not authorized to access this resource",
      });
      return;
    }

    const userData = userDoc.data();

    res.status(200).json({
      message: "Login successful",
      data: {
        user: {
          uid: user.uid,
          email: user.email,
          ...userData,
        },
        token: idToken,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    if (
      error.code === "auth/user-not-found" ||
      error.code === "auth/wrong-password"
    ) {
      res.status(401).json({
        message: "Authentication Error",
        error: "Invalid email or password",
      });
    } else {
      res.status(500).json({
        message: "Login Error",
        error: error.message,
      });
    }
  }
});

exports.api = functions.https.onRequest(app);
