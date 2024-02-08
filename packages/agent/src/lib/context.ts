// Context is the current memory of the scene
// Our system creates the context asynchronously to maximize reaction time to the user's input
// We do the heavy lifting of generating the context in the background, and then cache it for later use
// Context is shared by all members of the scene and keyed by userIds

/** compose prompt template from variables and a context template
 * replace {{variables}} in {{ }} syntax with values from variables using the key names
 */
export const composeContext = ({ context, template }: any) => {
  // replace all {{variables}} in contextTemplate with values from variables using the key names
  const out = template.replace(/{{\w+}}/g, (match: any) => {
    const key = match.replace(/{{|}}/g, "");
    return context[key] ?? "";
  });
  return out;
};
