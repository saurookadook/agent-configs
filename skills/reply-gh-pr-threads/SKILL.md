---
name: reply-gh-pr-threads
description: "Reply to review threads on a GitHub pull request once their feedback is addressed, each reply ending \"Addressed in <commit>\". Use when asked to reply to PR feedback threads, or given PR URLs with a #discussion_r anchor."
---

# Reply to GitHub PR review threads

Post one reply per review thread, in the user's name, saying what changed and citing the commit that changed it. The request to reply is the approval to post. Show drafts and wait only when the user asks to see them first.

## Step 1: resolve the threads

Read the owner, repo, and PR number from the URL: `https://github.com/<owner>/<repo>/pull/<pr>`. An anchor `#discussion_r<id>` (or `#r<id>` on the files tab) names a review comment, and the thread that holds that comment is the target. A caller such as `review-gh-pr-feedback` may pass thread node ids (`PRRT_...`) instead.

Confirm the credential and hold the user's login:

```bash
gh api user --jq .login
```

If this fails, tell the user to run `gh auth login` and stop.

Fetch every review thread on the PR, and the PR's head branch:

```bash
gh api graphql -F owner=<owner> -F repo=<repo> -F pr=<pr> -f query='
query($owner:String!,$repo:String!,$pr:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$pr){
      url headRefName
      reviewThreads(first:100){
        pageInfo{hasNextPage endCursor}
        nodes{id isResolved isOutdated path line originalLine
          comments(first:100){nodes{databaseId url author{login} body createdAt}}}
      }
    }
  }
}'
```

If `hasNextPage` is true, page on with `reviewThreads(first:100, after:"<endCursor>")` until it is false.

An id that is in no thread on the PR is usually a typo. When one existing comment id is a near match, such as `62677` for `162677`, take it, and say so in the hand-back. Otherwise list the PR's thread root comment ids and ask.

Done when: you hold each target thread's node id, its full comment chain, its root comment's `databaseId`, its `path` and line, and the PR's head branch.

## Step 2: map each thread to its commit

Find the commit or commits that address each thread, in this conversation or in `git log` on the head branch. Each commit must be on the remote, or its link is dead: `git branch -r --contains <sha>` names `origin/<headRefName>`. If one is not pushed, say which, and stop.

A thread that no commit addresses gets a reply with no "Addressed in" line, and the reason no change was made.

Done when: every target thread has its full commit SHAs, or a stated reason for having none.

## Step 3: write each reply

Shape:

```md
<what changed: one or two sentences naming the decision, field or file>

<follow-up for the reviewer, if any>

Addressed in [<sha8>](https://github.com/<owner>/<repo>/pull/<pr>/commits/<full sha>)
```

- Write in the user's voice: first person, short and plain. Answer what the reviewer asked, and leave out how the work was done.
- A **follow-up** is an open point the change raised that bears on this thread: a question for the reviewer, or a related decision left untouched. Put each one on the thread it belongs to. Points you raised earlier in the conversation count.
- Two commits read `Addressed in [a](…) and [b](…)`.
- The reply carries no AI attribution. RSC-19 applies wherever the repo has it.

Done when: every target thread has a reply in this shape, and every open point from the conversation sits on exactly one thread.

## Step 4: post and check

GitHub threads are flat: every reply attaches to the thread's root comment, and the API refuses a reply to a reply. Post to the root comment's `databaseId`, and the reply lands at the end of the thread, after the reviewer's latest comment.

Build the body with a script, `{"body": "..."}`, write it to a file in the scratchpad, and post it:

```bash
gh api --method POST repos/<owner>/<repo>/pulls/<pr>/comments/<root databaseId>/replies --input <file>
```

The response carries the new comment's `id` and `body`. Check that `body` equals what you sent.

To change a reply that is already posted, edit it in place: `gh api --method PATCH repos/<owner>/<repo>/pulls/comments/<id> --input <file>` with `{"body": "..."}`. A second reply only adds noise.

Leave every thread unresolved. Resolve one only when the user asks:

```bash
gh api graphql -f id=<thread node id> -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}'
```

Done when: every reply is posted, and every returned `body` matches its draft.

## Step 5: hand back

For each thread, report the commit cited, the follow-up asked, and any id you took to be a typo. Say that the threads are still unresolved.
