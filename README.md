# Frieren Discord Logbook — Antigravity Implementation Package

Dokumen spesifikasi dan prompt implementasi untuk membuat bot Discord multi-server, Local Git Agent, otomasi logbook DERMAGA, bukti screenshot Playwright, dan dashboard admin saja.

## Cara memakai di Google Antigravity

1. Buat sebuah **Antigravity Project** dengan folder workspace untuk project baru. Jika ingin adaptasi kode lebih cepat, tambahkan juga local clones `Oktavian19/bot-services` dan `Oktavian19/logbook-cli` sebagai folder sumber/referensi (jangan mengubah proyek asli secara sembarangan).
2. Ekstrak paket **di root workspace** sehingga file `AGENTS.md` dan folder `docs/` tersedia, misalnya `workspace/docs/FRIEREN_DISCORD_LOGBOOK_PRD.md`.
3. Mulai Agent (pilih mode perencanaan jika tersedia), buka `docs/ANTIGRAVITY_IMPLEMENTATION_PROMPT.md`, lalu tempel isi file tersebut ke pesan Agent. Semua `@docs/...` menunjuk file nyata di root workspace.
4. Minta Agent meninjau seluruh dokumen, membuat implementation plan, kemudian mengimplementasikan dan menguji sistem dalam workspace. Jangan menaruh API key ataupun kredensial Discord/DERMAGA di chat atau source code; isikan di `.env` privat ketika menjalankan.
5. Uji seluruh alur menggunakan mock Discord/Gemini/DERMAGA sebelum memakai akun DERMAGA asli. Operator harus mengotorisasi tes yang dapat membuat entri nyata.

## Isi file

| Dokumen | Kegunaan |
|---|---|
| `docs/FRIEREN_DISCORD_LOGBOOK_PRD.md` | PRD v2 final: tujuan, UX, command, skenario, status, non-functional requirements, acceptance |
| `docs/ANTIGRAVITY_IMPLEMENTATION_PROMPT.md` | Prompt utama untuk Agent Antigravity, dengan `@docs/...` references |
| `docs/ARCHITECTURE_AND_API.md` | Desain komponen, API, skema database, kontrak data dan verifikasi portal |
| `docs/TEST_PLAN_AND_ACCEPTANCE.md` | Matriks test dan kriteria kelulusan |
| `docs/DEPLOYMENT_AND_SECURITY.md` | .env, Docker/deployment, installer, Funnel dan runbook |
| `docs/LOGBOOK_FORMAL_PROMPT.md` | Prompt terpisah untuk menghasilkan logbook bahasa Indonesia yang profesional |
| `docs/frieren_system_prompt_english.md` | Prompt persona Frieren **asli dari pengguna, tidak diubah** |
| `docs/frieren_gemini_example_english.md` | Contoh integrasi Gemini Discord **asli dari pengguna, tidak diubah**; kode ilustratif, bukan modul siap pakai |
| `AGENTS.md` | Aturan workspace untuk Agent |

## Keputusan eksplisit operator

- Hanya admin yang mengakses dashboard. Login diambil dari `.env`; operator memilih username `atmin` dan password `password123` untuk environment sendiri. `.env.example` harus berisi placeholder, bukan secret. Tailscale **Funnel tetap digunakan** dan **berarti dapat diakses internet publik**.
- Semua reminder, draft, konfirmasi, dan bukti screenshot ke **Discord DM**; channel server hanya checklist dan ping terakhir.
- Local Agent terpasang lewat download yang dibagikan Discord, project Git tetap di laptop pengguna.
- Screenshot diambil **setelah reload halaman monitoring dan verifikasi DOM**—bukan hanya setelah submit.

## Repositori referensi

- https://github.com/Oktavian19/bot-services
- https://github.com/Oktavian19/logbook-cli
- https://jti.polinema.ac.id/dermaga/login

Dokumen ini bukan aplikasi yang sudah diimplementasikan, dan tidak mengandung executable installer ataupun kredensial nyata.
