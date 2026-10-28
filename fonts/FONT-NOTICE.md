# Paperlogy 글꼴 사용 기록 (Camping_Version 웹)

| 항목 | 내용 |
| --- | --- |
| 글꼴 | 페이퍼로지 (Paperlogy) v1.001 — Copyright 2024 The PAPERLOGY Authors (https://freesentation.blog/paperlogy) |
| 라이선스 | SIL Open Font License 1.1 — 전문은 같은 폴더의 `OFL.txt` (배포할 때 함께 둠) |
| 받은 원본 | `D:\Diorama_Contents\Fonts\Paperlogy-1.001.zip` (노을 버전 `work/sunset-diorama/fonts/`에서 복사, 라이선스 확인 기록은 그 폴더의 FONT-NOTICE.md) |
| 파일 | ZIP 원본 그대로 (변환·서브셋 없음) |

| 파일 | CSS 굵기 | SHA-256 |
| --- | --- | --- |
| `Paperlogy-4Regular.ttf` | 400 (500도 이 파일) | `05e1021e3de620dddc97875342e2be1a94c5f8e9b9f792bd16c4c1d0085343b3` |
| `Paperlogy-6SemiBold.ttf` | 600 | `ca92034a1c4602a57c55434dfdbf8428a0bb88ac84a99a5effec1a41f0118127` |
| `Paperlogy-7Bold.ttf` | 700 | `7effb892621474e9c2a9112f482eb87dd25b65a470e5ae5971be5a68d89ad89b` |

## 빈칸 글자 주의
- 한글 11,172자가 글꼴 표에는 있지만 모양이 있는 글자는 2,780자뿐 → 그냥 쓰면 나머지가 **빈칸**으로 보임.
- 그래서 `paperlogy.css`의 `unicode-range`에 모양이 있는 글자만 적음 → 없는 글자는 맑은 고딕(등)으로 보임 (빈칸 없음).
- `paperlogy.css`는 `python tools/make_font_css.py`로 만듦. 새 문구 확인: `python tools/make_font_css.py --check "문구"`.
- 2026-10-29 기준 사이트 문구(인트로 presentation.json + 화면 코드)의 한글 453자는 세 굵기 모두 모양이 있음.
