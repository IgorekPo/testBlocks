# Marinade Hero demo

## Assets

Only one image is required:

- `assets/golden-liquid.webp` — the main full-section background image.

The files `ecofry-liquid.webp` and `falling-spices.webp` are no longer used. You can remove them from the assets folder.

## Run

1. Keep `index.html`, `style.css`, and `script.js` in the project root.
2. Keep `golden-liquid.webp` inside `assets/`.
3. Open the project with VS Code Live Server.
4. The page needs an internet connection to load Three.js and the web fonts from their CDNs.

## Controls

- Desktop: move the mouse anywhere over the Hero section.
- Mobile: press “УВІМКНУТИ РУХ” and allow motion sensor access. Device orientation generally requires HTTPS; iOS asks for permission after the button is pressed.

The liquid effect is a real-time image displacement/ripple shader, not a full fluid simulation. The image is scaled to cover the whole Hero without stretching; some cropping may occur depending on the image and screen aspect ratios.
