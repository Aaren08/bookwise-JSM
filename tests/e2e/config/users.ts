// Define standard test users for different roles in the application
// For production, these should preferably be generated dynamically or pulled from a secure environment file

export const testUsers = {
  admin: {
    email: process.env.ADMIN_TEST_EMAIL || "schneiderneil392@gmail.com",
    password: process.env.ADMIN_TEST_PASSWORD || "zxcvbnm,",
    role: "ADMIN",
  },
  standardUser: {
    email: process.env.USER_TEST_EMAIL || "makimadena891@gmail.com",
    password: process.env.USER_TEST_PASSWORD || "makimadena123",
    role: "USER",
  },
  // Used when testing account locks, invalid states, etc.
  lockedUser: {
    email: "makimadena891@gmail.com",
    password: "makimadena123",
    role: "USER",
  },
};
