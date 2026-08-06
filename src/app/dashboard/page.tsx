import type { Metadata } from "next";
import { DashboardExperience } from "@/components/dashboard/DashboardExperience";

export const metadata: Metadata = {
  title: "Dashboard prototype",
  description: "A responsive prototype of the RoleDawn application control room.",
};

export default function DashboardPage() {
  return <DashboardExperience />;
}
