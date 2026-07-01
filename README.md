# nikkXmovie Movie & Anime Portal - Setup Guide (Hinglish)

Bhai, yeh aapki website ka code ready hai. Original target website (`https://movies4u.pn/`) ke download links isme masked (chupaye) hain aur server-side proxy backend configure hai.

Aapke system me Node.js nahi hai, isliye isko chalane ke liye aapko niche diye gaye aasan steps follow karne honge. Yeh sirf **2-3 minute** ka kaam hai.

---

## Step 1: Node.js Install Karein (Sirf 1 baar karna hai)

1. Apne web browser me yeh website open karein: **[https://nodejs.org/](https://nodejs.org/)**
2. Wahan jo **LTS** (Recommended for most users) likha hoga, us button pe click karke install file download karein.
3. Setup run karein aur simple screen par `Next` -> `Next` karke install kar lein. (Koi configuration change nahi karni).

---

## Step 2: Code Folder Open Karein (Terminal / CMD)

1. Apne system me **Command Prompt (CMD)** open karein.
2. CMD me niche likhi command enter karein aur `Enter` dabayein:
   ```cmd
   cd "C:\Users\Hp 992\OneDrive\Desktop\website"
   ```

---

## Step 3: Dependencies Install Karein

Folder me enter hone ke baad, dependencies install karne ke liye CMD me yeh command likhein aur `Enter` dabayein:
```cmd
npm install
```
*Yeh automatic `express`, `axios`, `cheerio` aur `cors` packages install kar dega jo hamari website chalane ke liye zaroori hain.*

---

## Step 4: Website Start Karein

Ab website ko run karne ke liye CMD me yeh command run karein:
```cmd
npm start
```
Aapko CMD me screen par print hoga:  
`Server is running at http://localhost:3000`

---

## Step 5: Browser me Open Karein

Apne Chrome ya kisi bhi browser me open karein:
👉 **[http://localhost:3000](http://localhost:3000)**

Buss! Aapki premium movie website load ho jayegi aur original website se data load karke automatic show karegi. Kisi ko original link nahi dikhega.

---

### Links Kaise Chupayi (Mask) Gai Hain?
1. Kisi bhi page par original domain `movies4u.pn` ya download host domain direct code me expose nahi hain.
2. Movies grid load hone par detail IDs base64 encrypted pass hoti hain.
3. Download links is format me dikhte hain: `/api/download?id=aHR0cHM6Ly9tZHJpdmUuaW5rL21kaXNrLz...`
4. Jab koi user click karega, tab hamara server use background me decode karke automatic transfer kar dega. Browser ke inspect element ya network tab me original site search karne par nahi milegi!
