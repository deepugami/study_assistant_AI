import { HeroGeometric } from "@/components/HeroGeometric";

export default function Home() {
  return (
    <main className="overflow-hidden" style={{ height: "calc(100vh - 4rem)" }}>
      <HeroGeometric fullHeight />
    </main>
  );
}
