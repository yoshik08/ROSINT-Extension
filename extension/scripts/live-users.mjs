// Which real profiles the live scripts use. Nothing is hard-coded: pass a
// username as the first argument or set the environment variables below.
//   REDDIT_HIDDEN_USER    a profile that hides its post/comment history
//   REDDIT_HIDDEN_USER_2  a second hidden profile this browser has never opened
//                         (used by the outage drill and the service diagnosis)

function need(value, variable) {
    if (value) return value;
    console.error(`Set ${variable} (or pass a username) to a Reddit profile that hides its history.`);
    process.exit(2);
}

export function hiddenUser(argument) {
    const fromArgs = argument && !argument.startsWith('--') ? argument : null;
    return need(fromArgs || process.env.REDDIT_HIDDEN_USER, 'REDDIT_HIDDEN_USER');
}

export function secondHiddenUser() {
    return need(process.env.REDDIT_HIDDEN_USER_2, 'REDDIT_HIDDEN_USER_2');
}
