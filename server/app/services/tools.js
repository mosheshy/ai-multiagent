// Minimal tools used by routerAgent. These are simple stubs so the demo
// can run without external web search dependencies.
export async function webSearch(query, maxResults = 3) {
  // In a real app, you'd call a search API (Bing/Google/SerpAPI) here.
  // Return an array of { title, url } objects. For now return an empty list
  // to keep the system predictable.
  return [];
}
