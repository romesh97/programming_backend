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
    origin: ["https://damp-cemetery-xqq4w9xvr673vggx.github.dev/"],
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
          contact: fields.contact,
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

// implement update api

// ----------------------------------- UPDATE POST ---------------------------------

app.put("/updatePost/:petId", async (req, res) => {
  const petId = req.params.petId;

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

    // Check if pet post exists and belongs to the user
    const petDoc = await userRef.doc(petId).get();

    if (!petDoc.exists) {
      return res.status(404).json({
        message: "Pet post not found",
        data: {},
        error: "Not Found",
      });
    }

    const petData = petDoc.data();
  
// TODO: check with multi media upload part later
    const form = new formidable.IncomingForm({ multiples: true });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        return res.status(400).json({
          message: "There was an error parsing the files",
          data: {},
          error: err,
        });
      }

      try {
        let updateData = {};

        // Update text fields 
        if (fields.name) updateData.name = fields.name;
        if (fields.age) updateData.age = fields.age;
        if (fields.weight) updateData.weight = fields.weight;
        if (fields.title) updateData.title = fields.title;
        if (fields.location) updateData.location = fields.location;
        if (fields.gender) updateData.gender = fields.gender;
        if (fields.contact) updateData.contact = fields.contact;
        if (fields.breed) updateData.breed = fields.breed;

        // provides public URL
        const profileImage = files.profileImage;
        if (profileImage && profileImage.size > 0) {
          let uuid = UUID();
          var downLoadPath =
            "https://firebasestorage.googleapis.com/v0/b/emerald-eon-438919-g7.appspot.com/o/";
          const bucket = storage.bucket(
            "gs://emerald-eon-438919-g7.appspot.com"
          );

          // Delete old image if exists
          // if (petData.profileImage) {
          //   const oldImagePath = petData.profileImage
          //     .split("?")[0]
          //     .split("/o/")[1];
          //   try {
          //     await bucket.file(decodeURIComponent(oldImagePath)).delete();
          //   } catch (deleteError) {
          //     console.log("Error deleting old image:", deleteError);
              
          //   }
          // }

          // Upload new image
          const imageResponse = await bucket.upload(profileImage.path, {
            destination: `pets/${profileImage.name}`,
            resumable: true,
            metadata: {
              metadata: {
                firebaseStorageDownloadTokens: uuid,
              },
            },
          });

          updateData.profileImage =
            downLoadPath +
            encodeURIComponent(imageResponse[0].name) +
            "?alt=media&token=" +
            uuid;
        }

        // Update petData
        await userRef.doc(petId).update(updateData);

        // Get the updated document
        const updatedPetDoc = await userRef.doc(petId).get();
        const updatedPetData = updatedPetDoc.data();

        res.status(200).json({
          message: "Pet post updated successfully",
          data: updatedPetData,
          error: {},
        });
      } catch (updateError) {
        res.status(500).json({
          message: "Error updating pet post",
          data: {},
          error: updateError.message,
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

// ----------------------------------- GET POST BY POST ID ---------------------------------

app.get("/getPostById/:postId", async (req, res) => {
  const postId = req.params.postId;

  // Verify auth token
  // const authHeader = req.headers.authorization;
  // if (!authHeader || !authHeader.startsWith("Bearer ")) {
  //   return res.status(401).json({
  //     message: "No authentication token provided",
  //     data: {},
  //     error: "Unauthorized",
  //   });
  // }

  const token = authHeader.split(" ")[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const userId = decodedToken.uid;

    const postDoc = await userRef.doc(postId).get();

    if (!postDoc.exists) {
      return res.status(404).json({
        message: "Post not found",
        data: {},
        error: "Not Found",
      });
    }

    const postData = postDoc.data();

    // // check users id with post id
    // if (postData.userId !== userId) {
    //   return res.status(403).json({
    //     message: "You don't have permission to access this post",
    //     data: {},
    //     error: "Forbidden",
    //   });
    // }

    res.status(200).json({
      message: "Post retrieved successfully",
      data: postData,
      error: {},
    });
  } catch (authError) {
    res.status(401).json({
      message: "Invalid or expired authentication token",
      data: {},
      error: authError.message,
    });
  }
});

// --------------------------------------GET ALL POSTS----------------------------------------

app.get("/getAllPosts", async (req, res) => {
  try {
    // Fetch all posts
    const postQuerySnapshot = await userRef.get();
    const posts = postQuerySnapshot.docs.map((doc) => doc.data());

    res.status(200).json({
      message: "Posts retrieved successfully",
      data: posts,
      error: {},
    });
  } catch (error) {
    res.status(500).json({
      message: "Error retrieving posts",
      data: [],
      error: error.message,
    });
  }
});

// --------------------------------------GET ALL POSTS BY USER ID----------------------------------------

app.get("/getPosts/:userId", async (req, res) => {
  const userId = req.params.userId;

  try {
    const postQuerySnapshot = await userRef.where("userId", "==", userId).get();
    const posts = postQuerySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json({
      message: "Posts retrieved successfully",
      data: posts,
      error: {},
    });
  } catch (error) {
    res.status(500).json({
      message: "Error retrieving posts",
      data: [],
      error: error.message,
    });
  }
});

// --------------------------------------DELETE POST FROM POST ID----------------------------------------

app.delete("/deletePost/:postId", async (req, res) => {
  const postId = req.params.postId;
  try {
    await userRef.doc(postId).delete();
    res.status(200).json({
      message: "Post deleted successfully",
      error: {},
    });
  } catch (error) {
    res.status(500).json({
      message: "Error deleting post",
      error: error.message,
    });
  }
});

exports.api = functions.https.onRequest(app);
