const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: 'https://integrate.api.nvidia.com/v1'
});

async function testExtraction() {
    const leads = [
        {
            "raw": "Jai Durga Dharm Kata 7J2H+HR8 रायपुर, छत्तीसगढ़ 4.5 (123) 10+ years in business",
            "location": "https://www.google.com/maps/place/Jai+Durga+Dharm+Kata/@21.2415,81.6322,17z/data=!3m1!4b1!4m6!3m5!1s0x3a28de..."
        },
        {
            "name": "Raipur Bu - Real esta 4.5",
            "phone": "09876543210",
            "address": "Close to Piyush Nagar"
        },
        {
            "raw": "No review Piru-2 Opp. Gate No 3"
        }
    ];

    const prompt = `
        You are a Professional Data Extraction AI. 
        Your task is to extract structured data from the provided JSON array of lead data.
        The data may contain raw, messy, or unstructured entries.

        IDENTIFY AND EXTRACT these fields for each entry:
        1. "name": The business or person's name. 
           - **NOISE REMOVAL**: Strip ratings (e.g., "4.5"), counts (e.g., "(123)"), and business years.
        2. "phone": The most valid Indian mobile number.
           - **PURITY**: Extract ONLY 10 digits. Strip '0', '+91', and spaces. Output as 91 + 10 digits.
           - **STRIP**: Remove all address parts or Plus Codes from this field.
        3. "address": The full street address. Include Plus Codes here.
        4. "occupation": The profession or business type.
        5. "city": Specific city name (TEXT ONLY).
        6. "state": State name (TEXT ONLY).

        GOOGLE MAPS LINK RULES:
        - Decode '/maps/dir/' or '/maps/place/' URLs for Business Names or Addresses.
        - URLs belong ONLY in the "location" field.

        JUNK FILTERING (Mark with "isJunk: true"):
        - Entries with NO valid phone number AND no business name.
        - Entries that are just business hours or closing times.
        - Entries that look like generic placeholders (e.g., "No review", "Piru-2").

        CLEANING & NORMALIZATION RULES:
        - **COLUMN NOISE**: Separate PlusCodes and Names.
        - Convert all text to Proper Case format.

        Return ONLY the extracted and cleaned JSON array with these keys: name, phone, email, address, occupation, city, state, source, location, isJunk.
        
        Data to process: ${JSON.stringify(leads)}
    `;

    try {
        console.log("Sending request to NVIDIA NIM...");
        const completion = await openai.chat.completions.create({
            model: "meta/llama-3.1-70b-instruct",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
            top_p: 1,
            max_tokens: 4096,
        });

        const text = completion.choices[0]?.message?.content || "";
        console.log("Raw Response:", text);

        const jsonMatch = text.match(/\[.*\]/s);
        if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]);
            console.log("\n--- Cleaned Data ---");
            console.log(JSON.stringify(data, null, 2));
        } else {
            console.log("Failed to extract JSON from response.");
        }
    } catch (e) {
        console.error("Extraction Failed:", e.message);
    }
}

testExtraction();
