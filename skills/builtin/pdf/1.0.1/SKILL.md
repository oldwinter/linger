---
name: pdf
description: Read, create, or change PDF files with Python. Use for text and table extraction, page operations, forms, OCR, or a PDF deliverable.
---

# PDF work with Python

## Runtime

Nothing here is preinstalled; set up what the task needs yourself. The active Context has an isolated project in `./agent`. Add packages for the operation at hand:

```bash
uv --directory ./agent add pypdf
uv --directory ./agent add pymupdf
uv --directory ./agent add reportlab
```

Use `uv --directory ./agent run python ...` for scripts. Resolve script, input, and output paths to absolute paths before calling `uv`, because `--directory` changes the command's working directory. Write working files to the current Context's `./playground/<scope>/` directory and publish the final PDF through the available delivery tool.

Command-line tools such as Poppler (`pdftotext`, `pdftoppm`), `qpdf`, and Tesseract are system tools that may be absent. Prefer the Python packages above when they can do the job, and check for a command before relying on it, for example `command -v pdftotext`. If `uv` or a system tool you need is missing, follow the install rule in your instructions: ask the user whether to install it, and install nothing globally without their yes.

## Choose the operation

| Task | Python approach |
| --- | --- |
| Merge, split, rotate, watermark, metadata, forms | `pypdf` |
| Extract positioned text or images; render pages for inspection | `pymupdf` (`fitz`) |
| Create a document with flowing text, tables, and page breaks | ReportLab Platypus |
| Draw a fixed page or overlay | ReportLab canvas |
| Scanned pages | Render pages, then use Tesseract only for the pages needing OCR |

Check whether text extraction works before starting OCR. Preserve source page order, orientation, crop boxes, annotations, and form values unless the task asks to change them. For protected documents, respect the user's access and the PDF's permissions.

## Small page operation

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("/absolute/path/input.pdf")
writer = PdfWriter()
for page in reader.pages:
    writer.add_page(page)
with open("/absolute/path/output.pdf", "wb") as file:
    writer.write(file)
```

Use document metadata supplied by the user or derived from the document. Do not insert a vendor name, web address, or promotional metadata.

## Check the result

Open the result again with `pypdf` or `pymupdf`. Compare page count, page sizes, text or form fields, and metadata with the request. Render and visually inspect every affected page for clipping, missing glyphs, and misplaced overlays. For generated CJK PDFs, register and embed a font that covers the document's characters; verify extracted text as well as the render. If a needed font or renderer is unavailable, describe the remaining check plainly.
