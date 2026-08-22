#!/usr/bin/env python3
"""Build an A4 PMC booking report that mirrors the LINE Flex receipt layout."""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime
from pathlib import Path

from PIL import Image
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader


PAGE_W, PAGE_H = A4
BG = HexColor("#F4F1ED")
WHITE = HexColor("#FFFFFF")
TEXT = HexColor("#282624")
SECONDARY = HexColor("#77716D")
GOLD = HexColor("#B78220")
SEPARATOR = HexColor("#E6E3DF")
AVATAR_BG = HexColor("#F4F1EC")
TILE_BG = HexColor("#F6F5F3")

THAI_MONTHS = [
    "มกราคม",
    "กุมภาพันธ์",
    "มีนาคม",
    "เมษายน",
    "พฤษภาคม",
    "มิถุนายน",
    "กรกฎาคม",
    "สิงหาคม",
    "กันยายน",
    "ตุลาคม",
    "พฤศจิกายน",
    "ธันวาคม",
]

PROFILE_PATHS = {
    "แคท": "assets/staff-profiles/cat.jpg",
    "มัส": "assets/staff-profiles/mus.jpg",
    "มิ้น": "assets/staff-profiles/mint.jpg",
    "แวว": "assets/staff-profiles/waew.jpg",
    "หมวย": "assets/staff-profiles/muay.jpg",
    "อาย": "assets/staff-profiles/eye.jpg",
}


def register_fonts() -> None:
    regular_path = "/System/Library/Fonts/Supplemental/Tahoma.ttf"
    bold_path = "/System/Library/Fonts/Supplemental/Tahoma Bold.ttf"
    pdfmetrics.registerFont(TTFont("Thonburi", regular_path))
    pdfmetrics.registerFont(TTFont("Thonburi-Bold", bold_path))


def fit_font(text: str, font: str, max_size: float, min_size: float, width: float) -> float:
    size = max_size
    while size > min_size and pdfmetrics.stringWidth(text, font, size) > width:
        size -= 0.5
    return size


def draw_centered(c: canvas.Canvas, text: str, y: float, font: str, size: float, color) -> None:
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawCentredString(PAGE_W / 2, y, text)


def format_appointment(raw: str) -> tuple[str, str]:
    value = datetime.fromisoformat(raw)
    return (
        f"{value.day} {THAI_MONTHS[value.month - 1]} {value.year + 543}",
        f"เวลา {value:%H:%M} น.",
    )


def separator(c: canvas.Canvas, x: float, y: float, width: float) -> None:
    c.setStrokeColor(SEPARATOR)
    c.setLineWidth(0.8)
    c.line(x, y, x + width, y)


def section_title(c: canvas.Canvas, text: str, x: float, y: float) -> None:
    c.setFillColor(TEXT)
    c.setFont("Thonburi-Bold", 12)
    c.drawString(x, y, text)


def key_value(c: canvas.Canvas, label: str, value: str, x: float, y: float, width: float,
              emphasized: bool = False) -> None:
    label_size = 10 if not emphasized else 11
    value_size = 10 if not emphasized else 15
    c.setFont("Thonburi", label_size)
    c.setFillColor(TEXT if emphasized else SECONDARY)
    c.drawString(x, y, label)
    font = "Thonburi-Bold"
    value_size = fit_font(value, font, value_size, 8, width * 0.62)
    c.setFont(font, value_size)
    c.setFillColor(GOLD if emphasized else TEXT)
    c.drawRightString(x + width, y, value)


def rounded_image(c: canvas.Canvas, image_path: str, x: float, y: float, width: float,
                  height: float, fit: str = "contain", radius: float = 12) -> None:
    path = Path(image_path)
    if not path.exists():
        c.setFillColor(TILE_BG)
        c.roundRect(x, y, width, height, radius, fill=1, stroke=0)
        return
    with Image.open(path) as img:
        img_w, img_h = img.size
    c.saveState()
    clip = c.beginPath()
    clip.roundRect(x, y, width, height, radius)
    c.clipPath(clip, stroke=0, fill=0)
    c.setFillColor(TILE_BG)
    c.rect(x, y, width, height, fill=1, stroke=0)
    if fit == "cover":
        scale = max(width / img_w, height / img_h)
    else:
        scale = min(width / img_w, height / img_h)
    draw_w, draw_h = img_w * scale, img_h * scale
    draw_x = x + (width - draw_w) / 2
    draw_y = y + (height - draw_h) / 2
    c.drawImage(ImageReader(str(path)), draw_x, draw_y, draw_w, draw_h,
                preserveAspectRatio=False, mask="auto")
    c.restoreState()


def avatar(c: canvas.Canvas, name: str, x: float, y: float, size: float, repo_root: Path) -> None:
    c.setFillColor(AVATAR_BG)
    c.circle(x + size / 2, y + size / 2, size / 2, fill=1, stroke=0)
    relative = PROFILE_PATHS.get(name)
    if not relative:
        return
    path = repo_root / relative
    if not path.exists():
        return
    c.saveState()
    clip = c.beginPath()
    clip.circle(x + size / 2, y + size / 2, size / 2)
    c.clipPath(clip, stroke=0, fill=0)
    c.drawImage(ImageReader(str(path)), x, y, size, size, mask="auto")
    c.restoreState()


def draw_page(c: canvas.Canvas, row: dict, index: int, total: int, repo_root: Path) -> None:
    c.setFillColor(BG)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)

    card_x, card_y = 55, 48
    card_w, card_h = PAGE_W - 110, PAGE_H - 82
    c.setFillColor(HexColor("#DED9D3"))
    c.roundRect(card_x + 2, card_y - 2, card_w, card_h, 20, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.roundRect(card_x, card_y, card_w, card_h, 20, fill=1, stroke=0)

    inner_x = card_x + 27
    inner_w = card_w - 54
    logo_path = repo_root / "assets/pmc-flex-logo-v1.png"
    c.drawImage(ImageReader(str(logo_path)), PAGE_W / 2 - 25, card_y + card_h - 62,
                50, 50, preserveAspectRatio=True, mask="auto")
    draw_centered(c, "PROMED CLINIC", card_y + card_h - 82, "Thonburi", 8, SECONDARY)
    draw_centered(c, "จองเคสใหม่", card_y + card_h - 108, "Thonburi-Bold", 18, GOLD)
    date_text, time_text = format_appointment(row["appointmentStart"])
    draw_centered(c, date_text, card_y + card_h - 133, "Thonburi-Bold", 12, TEXT)
    draw_centered(c, time_text, card_y + card_h - 151, "Thonburi", 9.5, SECONDARY)

    y = card_y + card_h - 173
    separator(c, inner_x, y, inner_w)
    y -= 23
    section_title(c, "ข้อมูลลูกค้า", inner_x, y)
    y -= 21
    customer_size = fit_font(row["customerName"], "Thonburi-Bold", 13, 9, inner_w)
    c.setFont("Thonburi-Bold", customer_size)
    c.setFillColor(TEXT)
    c.drawString(inner_x, y, row["customerName"])
    y -= 18
    c.setFont("Thonburi", 9.5)
    c.setFillColor(SECONDARY)
    c.drawString(inner_x, y, row["phone"])

    y -= 22
    separator(c, inner_x, y, inner_w)
    y -= 23
    section_title(c, "รายละเอียดการจอง", inner_x, y)
    y -= 22
    key_value(c, "แพทย์", row["doctor"], inner_x, y, inner_w)
    y -= 20
    key_value(c, "โปรแกรม", row["service"], inner_x, y, inner_w)
    y -= 20
    key_value(c, "ช่องทาง", row["channel"], inner_x, y, inner_w)
    y -= 23
    key_value(c, "ยอดจอง", f"{row['depositAmount']:,.0f} บาท", inner_x, y, inner_w, True)

    y -= 24
    separator(c, inner_x, y, inner_w)
    y -= 23
    section_title(c, "ทีมผู้ดูแล", inner_x, y)
    y -= 35
    label_x = inner_x
    avatar_x = inner_x + 122
    name_x = avatar_x + 39
    for label, name in [("Admin", row["adminName"]), ("AE", row["aeName"])]:
        c.setFont("Thonburi", 10)
        c.setFillColor(SECONDARY)
        c.drawString(label_x, y + 8, label)
        avatar(c, name, avatar_x, y, 28, repo_root)
        c.setFont("Thonburi-Bold", 10)
        c.setFillColor(TEXT)
        c.drawString(name_x, y + 8, name)
        y -= 36

    y -= 3
    separator(c, inner_x, y, inner_w)
    y -= 23
    section_title(c, "หลักฐาน", inner_x, y)
    y -= 132
    tile_gap = 16
    tile_w = (inner_w - tile_gap) / 2
    tile_h = 112
    payment = row.get("evidence", {}).get("payment", "")
    chat = row.get("evidence", {}).get("chat", "")
    rounded_image(c, payment, inner_x, y, tile_w, tile_h, "contain")
    rounded_image(c, chat, inner_x + tile_w + tile_gap, y, tile_w, tile_h, "cover")
    c.setFillColor(SECONDARY)
    c.setFont("Thonburi", 8.5)
    c.drawCentredString(inner_x + tile_w / 2, y - 13, "สลิป")
    c.drawCentredString(inner_x + tile_w + tile_gap + tile_w / 2, y - 13, "แชท 1")

    footer_y = card_y + 18
    c.setFont("Thonburi", 7.5)
    c.setFillColor(SECONDARY)
    c.drawString(inner_x, footer_y, row["caseId"])
    c.drawRightString(inner_x + inner_w, footer_y, f"หน้า {index}/{total}")
    c.showPage()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--repo-root", default=".")
    args = parser.parse_args()

    source = Path(args.source)
    output = Path(args.output)
    repo_root = Path(args.repo_root).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(source.read_text(encoding="utf-8"))
    rows = data.get("rows", [])
    if not rows:
        raise SystemExit("No booking rows found")

    register_fonts()
    pdf = canvas.Canvas(str(output), pagesize=A4, pageCompression=1)
    pdf.setTitle("PMC Booking Report - Flex Style")
    pdf.setAuthor("PROMED CLINIC")
    for index, row in enumerate(rows, start=1):
        draw_page(pdf, row, index, len(rows), repo_root)
    pdf.save()
    print(f"created={output}")
    print(f"pages={len(rows)}")


if __name__ == "__main__":
    main()
