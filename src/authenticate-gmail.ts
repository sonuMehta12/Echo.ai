// src/
import { promises as fs } from "fs";
import path from "path";
import process from "process";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";

// Define the same constants as our server
const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
const TOKEN_PATH = path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

/**
 * This script performs the initial OAuth 2.0 flow to generate and save
 * the user's authorization token. Run this script ONCE to create token.json.
 */
async function generateToken() {
  console.log("Starting authentication flow...");
  console.log("Your web browser will open. Please log in and grant permissions.");

  try {
    // This is the magic function that handles the entire flow.
    const client = await authenticate({
      scopes: SCOPES,
      keyfilePath: CREDENTIALS_PATH,
    });

    if (client.credentials) {
      // Save the credentials to the token.json file.
      await fs.writeFile(TOKEN_PATH, JSON.stringify(client.credentials));
      console.log(`✅ Token saved successfully to ${TOKEN_PATH}`);
      console.log("You can now start the main gmail-server.js application.");
    } else {
      console.error("Authentication failed: No credentials received.");
    }
  } catch (error) {
    console.error("Error during authentication:", error);
  }
}

generateToken();