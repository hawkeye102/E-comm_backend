import Usermodel from "../Models/userModels.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import sendEmail from "../config/sendEmail.js";
import crypto from "crypto";
import cloudinary from "../utils/cloudinary.js";
import ReviewModel from "../Models/ReviewModel.js";
import generateSignature from "../utils/cloudgensig.js";

import fs from "fs"

dotenv.config();



const generateAccessToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "6h" }); // Short-lived
};

const generateRefreshToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, { expiresIn: "17d" }); // Long-lived
};


//  Register new user
// route POST /api/users/register

export const registerUser = async (req, res) => {
  try {
    console.log(" Request received:", req.body);

    const { name, email, password } = req.body;

    // Check if user already exists
    const userExists = await Usermodel.findOne({ email });
    if (userExists) {
      return res.status(400).json({ success: false,message: "User already exists" });
    }
// Generate OTP
const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // OTP valid for 10 minutes

    console.log(" Plain Password before save:", password);

    

    // Create new user (Mongoose will hash password in pre-save hook)
    const user = await Usermodel.create({
      name,
      email,
      password, 
      otp,
      otpExpires,
     
      //  avatar,
      // mobile
    });

    // Generate tokens
    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    // Send refresh token in HTTP-only cookie
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    

     // Send OTP Email
     const subject = "Verify Your Email - OTP";
     const message = `Your OTP for account verification is: ${otp}. It will expire in 10 minutes.`;

     console.log("Sending OTP to:", email);
     await sendEmail(email, subject, message);
    console.log("User created successfully:", { id: user.id, email: user.email });

    if (user) {
      res.status(201).json({
        success: true,
        _id: user._id, // i have changed this if any error comes to frontent then we deal here
        name: user.name,
        email: user.email,
        avatar:user.avatar,
        mobile:user.mobile,
        accessToken,
      });
    } else {
      res.status(400).json({ message: "Invalid user data" });
    }
  } catch (error) {
    console.error("Error in registerUser:", error);
    res.status(500).json({ message: "Server Error" });
  }
};




// Login user & get token
// route POST /api/users/login

export const loginUser = async (req, res) => {
  try {
    console.log("Received login request:", req.body);

    const { email, password } = req.body;

    // Check if email and password are provided
    if (!email || !password) {
      console.warn(" Missing email or password");
      return res.status(400).json({ message: "Email and password are required" });
    }

    // Find user by email
    const user = await Usermodel.findOne({ email });

    if (!user) {
      console.warn("User not found for email:", email);
      return res.status(401).json({ message: "Invalid email or password" });
    }
// Generate tokens
const accessToken = generateAccessToken(user.id);
const refreshToken = generateRefreshToken(user.id);

// Store refresh token in HTTP-only cookie
res.cookie("refreshToken", refreshToken, {
  httpOnly: true,
  secure: true,
  sameSite: "Strict",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
});
    console.log(" User found:", { id: user.id, email: user.email });

    // Debugging password comparison
    console.log("Entered Password:", password);
    console.log("Stored Hashed Password:", user.password);

    // Compare entered password with stored hash
    
    const isMatch = await bcrypt.compare(password, user.password);

    console.log(" Password Match Result:", isMatch);

    if (!isMatch) {
      console.warn("Password did not match for user:", user.email);
      return res.status(401).json({ message: "Invalid email or password" });
    }

    console.log(" Login successful for user:", user.email);

    // Send response with user details and token
    return res.status(200).json({
      success:true,
      _id: user._id,
      name: user.name,
      email: user.email,
      mobile:user.mobile,
      avatar:user.avatar,
      accessToken,
      refreshToken 
    });
   
  } catch (error) {
    console.error(" Login Error:", error);
    return res.status(500).json({ message: "Server Error" });
  }
};

//  Get user profile
// route GET /api/users/profile

export const getUserProfile = async (req, res) => {
  try {
    const user = await Usermodel.findById(req.user.id).select("-password");
    if (user) {
      res.status(200).json({ success: true, user });
    } else {
      res.status(404).json({ success: false, message: "User not found" });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

export const verifyEmail = async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Find user by email
    const user = await Usermodel.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check OTP and expiry
    if (user.otp !== otp || user.otpExpires < Date.now()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    // OTP verified → Activate account & clear OTP
    user.otp = null;
    user.otpExpires = null;
    user.verify_email = true;
    await user.save();

    // Generate tokens
    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    // Optionally store refresh token in the database
    user.refreshToken = refreshToken;
    await user.save();

    // Send refresh token as HTTP-only cookie (recommended)
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(200).json({
      success:true,
      message: "OTP verified successfully",
      _id: user._id,
      name: user.name,
      email: user.email,
      verify_email: user.verify_email,
      accessToken,
    });

  } catch (error) {
    console.error("Error in verifyOtp:", error);
    res.status(500).json({ message: "Server Error" });
  }
};


//  Update user profile
//  PUT /api/users/profile
// access Private
export const updateUserProfile = async (req, res) => {
  try {
    console.log("User ID from Token:", req.user.id);
    console.log("Received Data:", req.body);
   

    const user = await Usermodel.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update basic fields
    user.name = req.body.name || user.name;
    user.email = req.body.email || user.email;
    user.mobile = req.body.mobile || user.mobile

   

    // Update password if provided
    if (req.body.password && req.body.password.trim() !== "") {
      user.password = req.body.password; // Ensure the model hashes it
    }

    // Save updated user
    const updatedUser = await user.save();
    console.log(" User profile updated successfully");

    // Send response
    res.json({
      success:true,
      _id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      mobile:updatedUser.mobile,
     
      // token: generateToken(updatedUser.id),
    });

  } catch (error) {
    console.error("Update Profile Error:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};



//Forgot Password Controller
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await Usermodel.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    // Generate a random 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    user.forget_password_otp = otp;
    user.forget_password_expiry = Date.now() + 10 * 60 * 1000; // OTP valid for 10 minutes
    await user.save();
    console.log("Saved User:", user);

    // this is done before to reduce time taken for uiupdates because of the db processes it takesa
    // a lot of time , we first update ui then send otp through send mail
    res.status(200).json({ message: "OTP sent to your email" });

    // Send OTP via email
    await sendEmail(user.email, "Password Reset OTP", `Your OTP is ${otp}`);

   

    
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const resetPassword = async (req, res) => {
  try {
    console.log('the response',req.body)
    const { email,newpassword } = req.body;

    const user = await Usermodel.findOne({ email });

    if (!user) return res.status(404).json({ message: "User not found" });

   

    // // Hash the new password
    // const salt = await bcrypt.genSalt(10);
    // const hashedPassword = await bcrypt.hash(newpassword, salt);

    // Update password and reset OTP fields
    user.password = newpassword;
  

    await user.save();
    console.log("After Change - Hashed Password:", user.password);

    res.status(200).json({success:true, message: "Password reset successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
};

export const verifyforgotpasswordOtp =async(req,res)=>{
  try {
const {email,otp} = req.body

const user = await Usermodel.findOne({email:email})
console.log(user)

if(!user){
  return res.status(400).json({
    message:"Email is not found",
    success : false
  })
 }
 console.log("Saved OTP:", user.forget_password_otp);  //Check stored OTP
 console.log("Stored Expiry:", user.forget_password_expiry, "Current Time:", Date.now()); //Check expiry time


 if(String(user.forget_password_otp)!==String(otp) || user.forget_password_expiry<Date.now()){
  return res.status(400).json({
    message:"the otp is expired or invalid",
    success:false
  })
 }
 // OTP is valid → Remove OTP fields
 user.forget_password_otp = null;
 user.forget_password_expiry = null;
 await user.save();

res.status(200).json({
  success:true,
  message:'the mail is  verified with the otp'
})
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
}

export const logoutUser = async (req, res) => {
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
  });
  res.status(200).json({ message: "Logged out successfully" });
};


export const Uploadavatar = async (req, res) => {
  try {
    console.log("Received Request to Upload Avatar");

    // Check if file is received
    if (!req.file) {
      console.error("No file received in request.");
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    console.log("File Received:", req.file);

    

   

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "avatars",
      width: 300,
      height: 300,
      crop: "fill",
    });

    console.log("Cloudinary Upload Response:", result);

    // Delete local file
    fs.unlinkSync(req.file.path);

    // Find user
    const user = await Usermodel.findById(req.user.id);
    if (!user) {
      console.error("User not found.");
      return res.status(400).json({ success: false, message: "User not found" });
    }

    user.avatar = result.secure_url;
    await user.save();

    console.log("Avatar updated successfully for user:", user._id);

    return res.status(200).json({
      success: true,
      avatar: user.avatar,
      message: "Avatar updated successfully",
    });

  } catch (error) {
    console.error("Internal Server Error:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};


// review controller 

export const addReview = async(req,res)=>{
try {
  const {Username,image,rating,comment, userId,productId} = req.body

  const userReview = new ReviewModel({
    Username:Username,
    image:image,
    rating:rating,
    comment:comment,
    userId:userId,
    productId:productId
})

await userReview.save();

 return res.status(200).json({
      success: true,
      message: "Review added successfully",
    });

} catch (error) {
    console.error("Internal Server Error:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
}


//get Review 
export const getReviews= async (req, res) => {
  try {
    const productId = req.query.productId;


    const reviews = await ReviewModel.find({ productId:productId });

    if(!reviews){
      return res.status(400).json({
        success:false,
        message:'Reviews not found'
      })
    }

    return res.status(200).json({
      success: true,
      reviews,
    });
  } catch (error) {
    console.error("Error fetching reviews:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};
