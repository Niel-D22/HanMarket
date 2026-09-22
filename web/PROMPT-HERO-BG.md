# Prompt gambar hero (versi foto-realistis, seperti referensi "Quantum")

Elemen di referensimu (planet bercahaya + pita cahaya melingkar + pecahan kristal
melayang) itu render 3D / gambar AI, bukan sesuatu yang bisa ditulis persis lewat CSS.
Sekarang website sudah punya versi CSS-nya (glow blob + "planet" gradient) sebagai
pengganti sementara. Generate gambar di bawah lewat Midjourney (kualitas terbaik untuk
render ini) atau Ideogram, lalu simpan sebagai `web/src/assets/hero-bg.jpg` — beri tahu
saya, saya sambungkan ke kodenya (tinggal satu baris).

## Prompt utama

```
A massive glowing planet made of dark obsidian and molten red-orange light, wrapped by
a swirling ribbon of warm light in a smooth infinity/flame shape, deep red #FA004A
blending into orange #FF8703 and gold #FDC747, set against a near-black background.
Small floating translucent crystal shards shaped like Chinese lanterns / trading
candlesticks scattered in the foreground, glowing faintly from within, dark red and
amber glass material. Cinematic volumetric lighting, ultra detailed, octane render,
8k, dramatic atmosphere, futuristic fintech aesthetic, no text, no logos.
--ar 9:16 --v 6
```

## Variasi ratio

- **Hero penuh layar (lebar):** ganti `--ar 9:16` jadi `--ar 16:9`
- **Mobile-friendly / lebih tinggi:** pakai `--ar 3:4`

## Setelah dapat gambar

1. Simpan di `web/src/assets/hero-bg.jpg` (atau `.png`, ukuran wajar <2MB — kompres dulu lewat squoosh.app kalau perlu)
2. Kabari saya — saya ganti div "planet" di `Landing.tsx` (yang sekarang pakai `radial-gradient`) jadi `background-image: url(...)`, tetap dengan glow CSS di atasnya supaya menyatu dengan warna website
