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
const TEPLATES_PATH = FILES_PATH + "/templates";
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

// app.get("/", (req, res) => {
//     res.send("Server is up!");
// });

app.post("/pdf", upload.array("files"), compile("pdf"));
app.post("/svg", upload.array("files"), compile("svg"));

app.get("/:file*", (req, res) => {
    // Get GET param file
    const file = (req.params as any as { file: string }).file;

    if (!file) {
        res.status(400).send("Bad Request");
        return;
    }

    // Check, that the file does not point outside of the files directory
    const normalizedPath = path.resolve(TEPLATES_PATH + "/" + file);
    const currentDir = path.resolve(TEPLATES_PATH);
    if (!normalizedPath.startsWith(currentDir)) {
        res.status(400).send("Bad Request");
        return;
    }

    // Get file extension
    const ext = path.extname(file);
    const baseName = path.basename(file, ext);

    // Detect, if files/prebuilt/{file}.pdf exists and is newer than files/{file}.typ
    // If not, compile files/{file}.typ to files/prebuilt/{file}.pdf
    const mainFile = TEPLATES_PATH + "/" + baseName + ".typ";
    if (!fs.existsSync(mainFile)) {
        res.status(404).send("Not Found");
        return;
    }

    const prebuiltFile = PREBUILT_PATH + "/" + baseName + ext;

    if (
        !fs.existsSync(prebuiltFile) ||
        fs.statSync(prebuiltFile).mtime < fs.statSync(mainFile).mtime
    ) {
        const compiler = NodeCompiler.create({
            workspace: FILES_PATH,
        });
        let result;
        if (ext === ".pdf") {
            result = compiler.pdf({
                mainFilePath: mainFile,
            });
            res.setHeader("Content-Type", "application/pdf");
        } else if (ext === ".svg") {
            result = compiler.svg({
                mainFilePath: mainFile,
            });
            res.setHeader("Content-Type", "image/svg+xml");
        } else {
            res.status(400).send("Bad Request");
            return;
        }

        // Make sure the target directory exists
        const directory = path.dirname(prebuiltFile);
        if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory, { recursive: true });
        }

        fs.writeFileSync(prebuiltFile, result as any);
    }

    // Get absolute path of prebuiltFile
    const absolutePath = path.resolve(prebuiltFile);
    res.sendFile(absolutePath);
});

httpServer.listen(port, "0.0.0.0", () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});
