import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import cors from "cors";
import dotenv from "dotenv";
import express, { Express, Request, Response } from "express";
import fs from "fs";
import http from "http";
import multer from "multer";
import path from "path";

dotenv.config();

const FILES_PATH = "./files";
const TEMP_PATH = FILES_PATH + "/upload";
const PREBUILT_PATH = FILES_PATH + "/prebuilt";
const TOKEN = process.env.TOKEN;

const app: Express = express();
const httpServer = http.createServer(app);
const port = process.env.PORT || 5000;
app.use(cors());

// app.use((err: any, req: any, res: any, next: any) => {
//     console.error(err.stack);
//     next(err);
// })

const storage = multer.diskStorage({
    destination: function (req, file, callback) {
        callback(null, TEMP_PATH);
    },
    filename: function (req, file, callback) {
        callback(null, file.originalname);
    },
});

const upload = multer({
    storage,
    limits: {
        fileSize: Infinity,
    },
});

function compile(format: "pdf" | "svg") {
    return (req: Request, res: Response) => {
        const files = req.files as Express.Multer.File[];
        console.log(files);
        const { mainFile, data, token } = req.body;

        if (token !== TOKEN) {
            res.status(401).send("Unauthorized");
            return;
        }

        const compiler = NodeCompiler.create({
            workspace: FILES_PATH,
            inputs: { data },
        });

        try {
            let result;
            switch (format) {
                case "pdf":
                    result = compiler.pdf({
                        mainFilePath: FILES_PATH + "/" + mainFile,
                    });
                    res.setHeader("Content-Type", "application/pdf");
                    break;
                case "svg":
                    result = compiler.svg({
                        mainFilePath: FILES_PATH + "/" + mainFile,
                    });
                    res.setHeader("Content-Type", "image/svg+xml");
                    break;
            }
            res.send(result);
        } catch (e) {
            res.status(500).send(e);
        } finally {
            // Delete all files
            files.forEach((file) => {
                fs.unlinkSync(file.path);
            });
        }
    };
}

app.post("/", (req, res) => {
    res.send("Server is up!");
});

app.get("/", (req, res) => {
    res.send("Server is up!");
});

app.post("/pdf", upload.array("files"), compile("pdf"));
app.post("/svg", upload.array("files"), compile("svg"));

app.get("/pdf", (req, res) => {
    // Get GET param file
    const file = req.query.file as string;
    if (!file) {
        res.status(400).send("Bad Request");
        return;
    }

    // Detect, if files/prebuilt/{file}.pdf exists and is newer than files/{file}.typ
    // If not, compile files/{file}.typ to files/prebuilt/{file}.pdf
    const mainFile = FILES_PATH + "/" + file + ".typ";
    if (!fs.existsSync(mainFile)) {
        res.status(404).send("Not Found");
        return;
    }

    const prebuiltFile = PREBUILT_PATH + "/" + file + ".pdf";

    if (
        !fs.existsSync(prebuiltFile) ||
        fs.statSync(prebuiltFile).mtime < fs.statSync(mainFile).mtime
    ) {
        const compiler = NodeCompiler.create({
            workspace: FILES_PATH,
        });
        const result = compiler.pdf({
            mainFilePath: mainFile,
        });
        // Make sure the target directory exists
        const directory = path.dirname(prebuiltFile);
        if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory, { recursive: true });
        }

        fs.writeFileSync(prebuiltFile, result as any);
    }

    res.setHeader("Content-Type", "application/pdf");
    // Get absolute path of prebuiltFile
    const absolutePath = path.resolve(prebuiltFile);
    res.sendFile(absolutePath);
});

httpServer.listen(port, "0.0.0.0", () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});
