import mongoose from "mongoose";



function connectDB() {
    console.log("MONGO_URI:", process.env.MONGO_URI);
    mongoose.connect(process.env.MONGO_URI).then(() => {
        console.log("Connected to MongoDB");
    }).catch((err) => {
        console.log("Error connecting to MongoDB: " + err);
        process.exit(1);
    });
}

export { connectDB };