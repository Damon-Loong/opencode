type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

// MOPC builds are distributed outside the upstream GitHub updater channel.
export const UPDATER_ENABLED = false
