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

const sendForm = (form: string, req: Request, res: Response) => {
    // Generate a simple plain HTML form with inputs defined in the form parameter as JSON (e.g. {"name": {"type": "text", "label": "Name"}, "age": {"type": "number", "label": "Age"}})
    // For additional get parameters, add them as hidden inputs to the form
    // The submit should lead to the same URL with the same GET parameters, but without the "form" parameter (GET)

    const formInputs = JSON.parse(form);

    const existingData = (req.query.data as string) || "{}";
    const additionalParams = Object.entries(req.query)
        .filter(([key]) => key !== "form" && key !== "data")
        .map(
            ([key, value]) =>
                `<input type="hidden" name="${key}" value="${value}">`,
        )
        .join("\n");

    const formHtml = `
        <!DOCTYPE html>
        <html lang="en" data-theme="light">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Typst Form</title>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
            <style>
                :root {
                    --pico-font-size: 100%;
                }
                body {
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
                    padding: 2rem;
                }
                .form-card {
                    background: white;
                    border-radius: 12px;
                    padding: 2.5rem;
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.06);
                    width: 100%;
                    max-width: 480px;
                }
                .form-card h1 {
                    margin-bottom: 1.5rem;
                    text-align: center;
                    color: var(--pico-primary);
                }
                .form-card form {
                    margin-bottom: 0;
                }
                .form-card input[type="submit"] {
                    width: 100%;
                    margin-top: 0.5rem;
                }
            </style>
        </head>
        <body>
            <main class="form-card">
                <h1>Doplnění údajů</h1>
                <form method="GET" action="${req.path}" id="typst-form">
                    ${additionalParams}
                    ${(
                        Object.entries(formInputs) as [
                            string,
                            { type: string; label: string },
                        ][]
                    )
                        .map(
                            ([name, { type, label }]) =>
                                `<label for="${name}">${label}<input type="${type}" name="${name}" id="${name}" placeholder="${label}"></label>`,
                        )
                        .join("\n")}
                    <input type="submit" value="Vygeneruj dokument">
                </form>
            </main>
            <script>
                document.getElementById("typst-form").addEventListener("submit", function(e) {
                    e.preventDefault();
                    const form = e.target;
                    const formData = new FormData(form);
                    const formInputKeys = ${JSON.stringify(Object.keys(formInputs))};
                    const data = JSON.parse(${JSON.stringify(existingData)});
                    for (const key of formInputKeys) {
                        const value = formData.get(key);
                        if (value) {
                            data[key] = value;
                        }
                    }
                    const params = new URLSearchParams();
                    for (const [key, value] of formData.entries()) {
                        if (key !== "data" && !formInputKeys.includes(key)) {
                            params.append(key, value);
                        }
                    }
                    if (Object.keys(data).length > 0) {
                        params.append("data", JSON.stringify(data));
                    }
                    window.location.href = form.action + "?" + params.toString();
                });
            </script>
        </body>
        </html>
    `;

    res.send(formHtml);
};

app.get("/*", (req, res) => {
    // Check if GET param "form" is set
    const form = req.query.form as string | undefined;
    if (form) {
        sendForm(form, req, res);
        return;
    }

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
