import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { migrateCategoriesFromShopify, migrateProductsFromShopify } from "../workflows"
import { promiseAll } from "@medusajs/framework/utils"

type Payload = {
  type: ("product" | "category")[]
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
        case "category":
          logger.info("Migrating categories from Shopify...")
          await migrateCategoriesFromShopify(container).run()
          break
        default:
          console.log(`Unknown type: ${type}`)
      }
    })
  )
}

export const config: SubscriberConfig = {
  event: "migrate.shopify",
}
