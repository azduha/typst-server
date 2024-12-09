import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import cors from "cors";
import dotenv from "dotenv";
import express, { Express, Request, Response } from "express";
import fs from "fs";
import http from "http";
import multer from "multer";

dotenv.config();

const FILES_PATH = "./files";
const TEMP_PATH = FILES_PATH + "/upload";

const app: Express = express();
const httpServer = http.createServer(app);
const port = process.env.PORT || 5000;
app.use(cors());

const storage = multer.diskStorage({
    destination: function (req, file, callback) {
        callback(null, TEMP_PATH);
    },
    filename: function (req, file, callback) {
        callback(null, file.originalname);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 1000000,
    },
});

function compile(format: "pdf" | "svg") {
    return (req: Request, res: Response) => {
        const files = req.files as Express.Multer.File[];
        console.log(files);
        const { mainFile, data } = req.body;

        const compiler = NodeCompiler.create({
            workspace: FILES_PATH,
            inputs: {data}
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
    }
}

app.get("/", (req, res) => {
    res.send("Server is up!");
});

app.post("/pdf", upload.array("files"), compile("pdf"));
app.post("/svg", upload.array("files"), compile("svg"));

httpServer.listen(port, () => {
    console.log(
        `⚡️[server]: Server is running at http://localhost:${port}`
    );
});
