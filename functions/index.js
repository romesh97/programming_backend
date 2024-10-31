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

// ----------------------------------- CREATE POST ---------------------------------

app.post("/createPost", async (req, res) => {
  // check user validity to send data
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "No authentication token provided",
      data: {},
      error: "Unauthorized",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const userId = decodedToken.uid;

    // check user is in firebase db collection
    const userDoc = await admin
      .firestore()
      .collection("Users")
      .doc(userId)
      .get();
    if (!userDoc.exists) {
      return res.status(403).json({
        message: "User not found in database",
        data: {},
        error: "Unauthorized",
      });
    }

    const form = new formidable.IncomingForm({ multiples: true });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        return res.status(400).json({
          message: "There was an error parsing the files",
          data: {},
          error: err,
        });
      }

      let uuid = UUID();
      var downLoadPath =
        "https://firebasestorage.googleapis.com/v0/b/emerald-eon-438919-g7.appspot.com/o/";

      const profileImage = files.profileImage;
      let imageUrl;

      // Generate a new document ID in the Pets collection
      const petDocId = userRef.doc().id;
      const bucket = storage.bucket("gs://emerald-eon-438919-g7.appspot.com");

      try {
        if (profileImage && profileImage.size > 0) {
          const imageResponse = await bucket.upload(profileImage.path, {
            destination: `pets/${profileImage.name}`,
            resumable: true,
            metadata: {
              metadata: {
                firebaseStorageDownloadTokens: uuid,
              },
            },
          });

          imageUrl =
            downLoadPath +
            encodeURIComponent(imageResponse[0].name) +
            "?alt=media&token=" +
            uuid;
        }

        // Create the pet document mapping with users Id
        const petData = {
          userId: userId,
          name: fields.name,
          age: fields.age,
          weight: fields.weight,
          title: fields.title,
          location: fields.location,
          gender: fields.gender,
          description: fields.description,
          breed: fields.breed,
          profileImage: profileImage && profileImage.size > 0 ? imageUrl : "",
        };

        // Save data to the store
        await userRef.doc(petDocId).set(petData);

        res.status(200).json({
          message: "Pet post created successfully",
          data: petData,
          error: {},
        });
      } catch (uploadError) {
        res.status(500).json({
          message: "Error uploading image or saving data",
          data: {},
          error: uploadError.message,
        });
      }
    });
  } catch (authError) {
    res.status(401).json({
      message: "Invalid or expired authentication token",
      data: {},
      error: authError.message,
    });
  }
});

exports.api = functions.https.onRequest(app);
