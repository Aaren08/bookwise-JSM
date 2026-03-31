const AVATAR_COLORS = [
  { bg: "bg-blue-100", text: "text-blue-600" },
  { bg: "bg-green-100", text: "text-green-600" },
  { bg: "bg-yellow-100", text: "text-yellow-600" },
  { bg: "bg-purple-100", text: "text-purple-600" },
  { bg: "bg-pink-100", text: "text-pink-600" },
  { bg: "bg-indigo-100", text: "text-indigo-600" },
  { bg: "bg-red-100", text: "text-red-600" },
  { bg: "bg-orange-100", text: "text-orange-600" },
  { bg: "bg-teal-100", text: "text-teal-600" },
  { bg: "bg-cyan-100", text: "text-cyan-600" },
];

// Generate consistent color based on user's name/email (deterministic)
export const getAvatarColor = (identifier: string) => {
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    hash = identifier.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
};
