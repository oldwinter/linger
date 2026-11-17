# Local parsing regression fixtures

These are synthetic documents generated in this repository; they hold no user data. `manifest.json` lists the body
facts that must survive; the tests separately check Office table column mapping, Excel dates and percentages, slide
notes and blank input.

- PDF: ReportLab text layers in Chinese and English, tables, two columns, a scanned page, text and a scanned area on
  one page, and a blank page. Only text layers are read, so the scanned page and the blank page give no body.
- Office: tables, formatted cells and notes generated with python-docx, python-pptx and openpyxl.
- ODF, EPUB, EML, MHTML: minimal standard XML, ZIP and MIME documents; DOTX changes the main content type of a
  synthetic DOCX.

Nothing is downloaded and no LibreOffice is needed. The fixtures prove that file paths and body extraction work; they make no promise about
two-column reading order, complex PDF tables, handwriting or low-quality scans.
