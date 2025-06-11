import { MedusaContainer } from "@medusajs/framework/types"

export default async function migrateShopifyJob(container: MedusaContainer) {
  const eventBusService = container.resolve("event_bus")

  eventBusService.emit({
    name: "migrate.shopify",
    data: {
      type: ["product", "collection"],
    },
  })
}

export const config = {
  name: "migrate-shopify-job",
  schedule: "0 0 * * *",
}
