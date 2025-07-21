import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import {
  migrateCategoriesFromShopify,
  migrateProductsFromShopify,
} from "../workflows";
import { promiseAll } from "@medusajs/framework/utils";
import { Modules } from "@medusajs/framework/utils";

type Payload = {
  type: ("product" | "category")[];
};

export default async function migrateShopifyHandler({
  event: { data },
  container,
}: SubscriberArgs<Payload>) {
  const logger = container.resolve("logger");
  const workflowEngineService = container.resolve(Modules.WORKFLOW_ENGINE);
  await promiseAll(
    data.type.map(async (type) => {
      let workflow, workflowId;
      switch (type) {
        case "product":
          logger.info("Migrating products from Shopify...");
          workflow = migrateProductsFromShopify(container);
          workflowId = "migrate-products-from-shopify";
          break;
        case "category":
          logger.info("Migrating categories from Shopify...");
          workflow = migrateCategoriesFromShopify(container);
          workflowId = "migrate-categories-from-shopify";
          break;
        default:
          logger.warn(`Unknown type: ${type}`);
          return;
      }

      const { transaction } = await workflow.run();

      const subscriptionOptions = {
        workflowId,
        transactionId: transaction.transactionId,
        subscriberId: `migrate-shopify-subscriber-${type}`,
      };

      await workflowEngineService.subscribe({
        ...subscriptionOptions,
        subscriber: async (data) => {
          if (data.eventType === "onFinish") {
            logger.info(`Migration for ${type} finished: ${data.result}`);
            await workflowEngineService.unsubscribe({
              ...subscriptionOptions,
              subscriberOrId: subscriptionOptions.subscriberId,
            });
          } else if (data.eventType === "onStepFailure") {
            logger.error(
              `Migration for ${type} failed at step: ${JSON.stringify(
                data,
                null,
                2
              )}`
            );
          }
        },
      });
    })
  );
}

export const config: SubscriberConfig = {
  event: "migrate.shopify",
};
