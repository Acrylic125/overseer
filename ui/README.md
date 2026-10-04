This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Visualization styles

Use the style selector in the upper left to switch between **Default** and
**Data Center**. Data Center turns service footprints into an outlined campus:
warehouses for storage, racks for compute, cylinders for databases, gantries
for queues, and watchtowers for EventBridge. Models follow each resource's
`size: [width, depth]`, including rectangular footprints. The illustration uses
a white background, warm cream surfaces, orange outlines and plinths, and pale blue bands and secondary
edges. Each part has a uniform fill and one continuous outline color on every
face. Sparse fences enclose the occupied service lots, including nested groups.
The public Internet appears as an outlined globe on a round pedestal. Warehouses
have sheltered loading bays, raised docks and stacked parcels. Floating labels
use left-aligned type/name text, with the measured text block and larger icon
centered vertically, without projection beams or stems. Racks use separate
cabinets with recessed trays, side louvers and roof cooling grilles. Databases,
gantries and towers have piping, control panels, bracing and platform fittings.
All connections are elevated conveyors with continuous curved belts and rails;
taped parcel boxes follow the same rounded centerline through the turns.

Open `/?style=data-center` directly; the chosen style is retained in the URL
and remembered in the browser.

Drag to orbit, right-drag to pan, and scroll to zoom. Explore mode and service
search/selection work in either style. Holograms show the service icon, type and
name above each building and face the camera. Conveyors follow the
existing connection paths; moving packet boxes illustrate connectivity rather
than measured live traffic. Use **Pause packets** to stop movement. The scene
also honors the system's reduced-motion preference.

## Isolated Docker testing

See [test-env/README.md](../test-env/README.md) for an isolated Compose environment
with a seeded Data Center campus, Docker-assigned localhost ports, and per-instance
state. Start and stop each instance with `test-env/manage.sh` from the checkout root.
