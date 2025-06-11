import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { migrateCollectionsFromShopify, migrateProductsFromShopify } from "../workflows"
import { promiseAll } from "@medusajs/framework/utils"

type Payload = {
  type: ("product" | "collection")[]
}

export default async function migrateShopifyHandler({
  event: { data },
  container,
}: SubscriberArgs<Payload>) {
  const logger = container.resolve("logger")
  await promiseAll(
    data.type.map(async (type) => {
      switch (type) {
        case "product":
          logger.info("Migrating products from Shopify...")
          await migrateProductsFromShopify(container).run()
          break
        case "collection":
          logger.info("Migrating collections from Shopify...")
          await migrateCollectionsFromShopify(container).run()
          break
        default:
          console.log(`Unknown type: ${type}`)
      }
    })
  )

  console.log("Finished migration from Shopify")
}

export const config: SubscriberConfig = {
  event: "migrate.shopify",
}
