# PDF Figure (pasiooooo)

Extract figures, tables, and formulae from Zotero PDFs.

This fork builds on [MuiseDestiny/zotero-figure](https://github.com/MuiseDestiny/zotero-figure). See the [changelog](CHANGELOG.md) and the [release guide](docs/RELEASING.md).

[English](README.md) | [简体中文](docs/README.zh-CN.md) | [Italiano](docs/README.it-IT.md) | [Русский](docs/README.ru-RU.md) | [日本語](docs/README.ja-JP.md) | [Español](docs/README.es-ES.md)

[![Latest release](https://img.shields.io/github/v/release/pasiooooo/zotero-figure)](https://github.com/pasiooooo/zotero-figure/releases)
[![License](https://img.shields.io/github/license/pasiooooo/zotero-figure)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/pasiooooo/zotero-figure/latest/total)](https://github.com/pasiooooo/zotero-figure/releases)

Zotero Figure detects PDF figures, tables, display formulae, captions, and table footnotes. PDF reading, rendering, and layout detection run locally with the model bundled in the plugin.

## Features

- Analyze PDFs locally without uploading pages or downloading a model at runtime.
- Review results in a dedicated Reader sidebar with combinable type filters that hide unavailable kinds, plus analysis progress.
- Copy, save, or pin an image; edit its caption or correct its crop in a dialog sized to the PDF page; open its PDF page; add it to a note; or remove it.
- In the PDF Reader, right-click a selected image annotation to add it to the local figure analysis results; existing Figure, Table, or Formula tags are preserved.
- Browse results from multiple documents in **PDF Figure Library**, with document, year, category, type, and caption filters. Switch between the remembered waterfall and document-column views; in document columns, results stay in stable page order across aligned, optionally named comparison rows. Drag document headers to reorder columns and cards within a document to rearrange rows, or right-click an image to add it to a comparison group. When one document contributes multiple images to a group, its cell shows a primary image with thumbnails on the left; select a thumbnail to make it primary. Dissolve a group to remove its comparison row, and use the toolbar scale control to resize all previews.
- Comparison layouts are stored locally in `zotero-figure-pasiooooo/comparison-layouts.json` inside the Zotero data directory, allowing large comparison tables. Existing layouts migrate automatically; include this file in backups. Layouts are not synchronized by Zotero Sync.
- Batch-analyze selected library items or PDF attachments, with optional note or Zotero annotation output.
- Translate captions when Zotero PDF Translate is installed.
- Optionally recognize formula LaTeX with SiliconFlow `Qwen/Qwen3.6-35B-A3B`, render it locally with KaTeX, and copy, re-recognize, or edit it with a CodeMirror source editor and live KaTeX preview.
- Create Zotero notes with embedded PNG images that link back to the source PDF.
- Optionally mirror local results to Zotero image annotations for synchronization and interoperability.
- Use the interface in English, Simplified Chinese, Italian, or Russian.

## Requirements

- Zotero 9 or Zotero 10.
- The Zotero Figure XPI from the [latest release](https://github.com/pasiooooo/zotero-figure/releases/latest).
- Formula OCR only: network access and a SiliconFlow API key.

Java and `pdffigures2.jar` are not required.

## Installation

**Upgrading from the original plugin or this fork's 1.1.0:** disable the old plugin, manually install 1.1.1 or later, and restart Zotero. The new add-on ID is `zotero-figure@pasiooooo.github.io`, so automatic updates cannot cross this identity change. First startup copies old results, layouts, models, and settings into this fork's separate storage without deleting originals. Keep the old plugin disabled during that copy; later changes are independent. Allow extra disk space for the copied data.

1. Download `zotero-figure.xpi` from the latest release.
2. In Zotero, open `Tools > Plugins`, choose **Install Plugin From File...**, and select the XPI.
3. Restart Zotero if requested.

## Entry Points

- **PDF Reader:** Open a PDF, select the Zotero Figure icon in the left sidebar, and choose **Analyze figures, tables, and formulae**.
- **Sidebar browsing:** Double-click a caption (including an empty caption) to edit it in a resizable text area. Results with missing or unnumbered captions come first; numbered figures, tables, and formulae are grouped by type and naturally sorted by their full numbers, including `1.2` and `1-10`. The second toolbar button opens a maximized Library with the current document preselected and the bottom toolbar collapsed. It retains the main Library's view mode and full set of results; expand the toolbar to switch documents or clear the initial filter.
- **Missed regions:** Choose **Recognize a selected region** in the Figure sidebar to show a screenshot-style selection overlay. Drag a rectangle on a PDF page and release to recognize it; Esc or right-click cancels. Include the caption when possible. If a figure or table caption is missing, an additional page detection pass supplies caption context without importing other figures. Caption text comes from the PDF text layer; scanned captions are not OCRed. Region recognition saves local results without creating Zotero annotations. Existing result cards also offer **Recognize this region again**. Only fully contained results are replaced; outside results and regions with no detections are preserved.
- **Figure Library:** Click the PDF Figure Library icon in the main window toolbar (to the left of the search box) to open a separate maximized window for browsing results across documents. The bottom toolbar starts collapsed; repeated clicks focus the existing window. Double-click a card to open its source PDF.
- **Library filters:** Collection and document buttons open a shared browser with Zotero's collection hierarchy and document-title search. Parent collections include their descendants; changing collections clears the selected document. Enter a year or inclusive range such as `2020–2024`, or click the histogram (counts represent extracted results). Undated documents remain visible under All years. Use the figure/table/formula icons to filter by type; click the active icon or the all-types button to reset the type. These controls also work in the maximized sidebar Library.
- **Correct Caption:** In a result’s context menu, choose **Correct Caption** and box the correct caption in the PDF. The selected PDF text replaces that result’s caption locally, without model downloads or paid API calls. PDFs without a text layer need OCR; empty selections keep the original caption.
- **Library zoom:** Hold Ctrl (Windows/Linux) or Command (macOS) and scroll for proportional zoom, or use `+`/`-` and `0` to zoom/reset. The slider and percentage input support 1% precision from 10% to 1000%. Updates are combined per animation frame; waterfall columns regroup after zooming stops. Also available in the maximized Library window.
- **Batch Processing:** Select library items or PDF attachments, right-click, and open `PDF Figure (pasiooooo) >` to analyze them, add results to notes, or create annotations. Select image annotations and choose `Add to Figure` for batch import.
  Before analysis, PDFs with saved results are listed for confirmation: reanalyze and replace them, skip them while processing new PDFs, or cancel the batch. Completed analyses with no detections also count as analyzed.
- **Automatic PDF analysis:** Enable **Automatically analyze newly added PDFs** under Preferences → Other (off by default). Only new PDFs are queued, one document at a time; existing analyses are skipped. Missing local files are retried for about five minutes. Disabling the option cancels automatic work and clears pending tasks. Annotation sync and paid formula recognition retain their separate settings.
- **Preferences:** Open the PDF Figure preferences pane to manage the bundled model, annotation synchronization, and SiliconFlow formula OCR, or to open the Figure Library directly. Use **Convert existing formulae** to recognize uncached formulae across libraries.

## Privacy

PDF parsing, rendering, layout detection, and local result storage stay on your computer. Local results do not use Zotero Sync unless you enable annotation mirroring.

Formula OCR is optional. API-key checking sends a text-only request to SiliconFlow. Formula recognition sends formula PNG crops, never full PDF pages; the key is stored in local Zotero preferences. SiliconFlow usage may incur charges.

## Links

- [Releases](https://github.com/pasiooooo/zotero-figure/releases)
- [Issues](https://github.com/pasiooooo/zotero-figure/issues)
- [AGPL-3.0-or-later license](LICENSE)
