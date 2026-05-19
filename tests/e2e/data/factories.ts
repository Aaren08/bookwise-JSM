import { faker } from "@faker-js/faker";

export const generateUserData = () => ({
  fullName: faker.person.fullName(),
  email: faker.internet.email({ provider: "playwright-test.com" }), // Identifiable test emails
  password: "TestPassword123!",
  idCardPath: "tests/e2e/data/mock-id.png", // Ensure this dummy file exists
  universityId: faker.number.int({ min: 100000, max: 999999 }).toString(),
});
