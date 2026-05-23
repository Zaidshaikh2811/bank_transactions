
import "./src/config/env.js";
import app from "./src/app.js";
import connectDB from "./src/config/db.js";



connectDB();
app.listen(process.env.PORT, () => {
    console.log("Server is running on port " + process.env.PORT);
});