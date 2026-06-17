import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import cors from "cors";
import dotenv from "dotenv";
import express, { Express, Request, Response } from "express";
import fs from "fs";
import http from "http";
import { JSDOM } from "jsdom";
import multer from "multer";
import path from "path";

dotenv.config();

const STATIC_PATH = "./static";
const FILES_PATH = "./files";
const TEMPLATES_PATH = FILES_PATH + "/templates";
const UPLOAD_PATH = FILES_PATH + "/upload";
const PREBUILT_PATH = FILES_PATH + "/prebuilt";
const TEMP_PATH = FILES_PATH + "/temp";
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
        callback(null, UPLOAD_PATH);
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

function getPageSVG(svg: string, page: number): string {
    // - Parse the SVG DOM
    // - find the <g> elements with class="typst-page"
    // - remove all elements except the page-th <g> element
    // - for the page-th <g> element, remove the transform attribute
    // - extract data-page-width and data-page-height attributes from the page-th <g> element and set them as viewport, width, height, data-width and data-height attributes of the root <svg> element
    // - return the whole document as string
    const parser = new JSDOM(svg, { contentType: "image/svg+xml" });
    const doc = parser.window.document;
    const pages = doc.querySelectorAll("g.typst-page");
    if (page < 1 || page > pages.length) {
        throw new Error("Page number out of range");
    }
    const pageElement = pages[page - 1];
    pages.forEach((p, index) => {
        if (index !== page - 1) {
            p.remove();
        } else {
            p.removeAttribute("transform");
        }
    });
    const svgElement = doc.documentElement;
    const pageWidth = pageElement.getAttribute("data-page-width");
    const pageHeight = pageElement.getAttribute("data-page-height");
    if (pageWidth && pageHeight) {
        svgElement.setAttribute("viewBox", `0 0 ${pageWidth} ${pageHeight}`);
        svgElement.setAttribute("width", pageWidth);
        svgElement.setAttribute("height", pageHeight);
        svgElement.setAttribute("data-width", pageWidth);
        svgElement.setAttribute("data-height", pageHeight);
    }
    return doc.documentElement.outerHTML;
}

function compile(format: "pdf" | "svg" | "html") {
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
                case "html":
                    result = compiler.html({
                        mainFilePath: FILES_PATH + "/" + mainFile,
                    });
                    res.setHeader("Content-Type", "text/html");
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

// Legacy support
app.post("/pdf", upload.array("files"), compile("pdf"));
app.post("/svg", upload.array("files"), compile("svg"));
app.post("/html", upload.array("files"), compile("html"));

app.get("/*", (req, res) => {
    // Get GET param file
    const file = (req.params as { "0": string })["0"];

    if (!file) {
        res.status(400).send("Bad Request");
        return;
    }

    // Check, that the file does not point outside of the files directory
    const normalizedPath = path.resolve(TEMPLATES_PATH + "/" + file);
    const currentDir = path.resolve(TEMPLATES_PATH);
    if (!normalizedPath.startsWith(currentDir)) {
        res.status(400).send("Bad Request");
        return;
    }

    // If the file exists in the /static directory, serve it directly
    const staticFile = STATIC_PATH + "/" + file;
    if (fs.existsSync(staticFile)) {
        res.sendFile(path.resolve(staticFile));
        return;
    }

    // Get file extension
    const ext = path.extname(file);
    const baseName = file.replace(ext, "");

    // Detect, if files/{file}.typ exists. If not, return 404
    const mainFile = TEMPLATES_PATH + "/" + baseName + ".typ";
    if (!fs.existsSync(mainFile)) {
        res.status(404).send("Not Found");
        return;
    }

    // Check if the param "page" is set
    const page = req.query.page
        ? parseInt(req.query.page as string)
        : undefined;

    const prebuiltFile =
        PREBUILT_PATH + "/" + baseName + ext + (page ? `.${page}` : "");
    const tempFile = TEMP_PATH + "/" + baseName + "_" + Date.now() + ext;

    // Check if GET param "data" is set
    const data = req.query.data as string | undefined;

    const useTempFile = data;

    if (
        !fs.existsSync(prebuiltFile) ||
        fs.statSync(prebuiltFile).mtime < fs.statSync(mainFile).mtime ||
        useTempFile
    ) {
        try {
            const compiler = NodeCompiler.create({
                workspace: FILES_PATH,
                inputs: data ? { data } : undefined,
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
                if (page !== undefined) {
                    result = getPageSVG(result as string, page);
                }
                res.setHeader("Content-Type", "image/svg+xml");
            } else if (ext === ".html") {
                result = compiler.html({
                    mainFilePath: mainFile,
                });
                res.setHeader("Content-Type", "text/html");
            } else {
                res.status(400).send("Bad Request");
                return;
            }

            // Make sure the target directory exists
            const directory = path.dirname(
                useTempFile ? tempFile : prebuiltFile,
            );
            if (!fs.existsSync(directory)) {
                fs.mkdirSync(directory, { recursive: true });
            }

            fs.writeFileSync(
                useTempFile ? tempFile : prebuiltFile,
                result as any,
            );
        } catch (e) {
            res.status(500).send(e);
            return;
        }
    }

    // Get absolute path of prebuiltFile or tempFile
    const absolutePath = path.resolve(useTempFile ? tempFile : prebuiltFile);
    res.sendFile(
        absolutePath,
        {
            headers: {
                "Cache-Control": "no-cache",
                "Content-Type":
                    {
                        ".pdf": "application/pdf",
                        ".svg": "image/svg+xml",
                        ".html": "text/html",
                    }[ext] || "application/octet-stream",
            },
        },
        () => {
            if (useTempFile) {
                fs.unlinkSync(absolutePath);
            }
        },
    );
});

httpServer.listen(port, "0.0.0.0", () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});
