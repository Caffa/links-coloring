# Instruction History

This file records all instructions sent to this project.

## 2026-03-27T16:00:21.500Z

I think my most recent changes to the code (see the commit) has caused some lag to the coloring of the links because when I scroll down, I see the links are all the same color before they fill it. Investigate.

An option to fix may be to only change the link coloring re-roll / reseed when I switch parent folder of the file instead of when I change file. 
We could also do some pre-processing of the file's links?

Analyse these two fixed options and give me a prediction of how they would affect the user experience.

## 2026-03-27T16:00:21.501Z

I think my most recent changes to the code (see the commit) has caused some lag to the coloring of the links because when I scroll down, I see the links are all the same color before they fill it. Investigate.

An option to fix may be to only change the link coloring re-roll / reseed when I switch parent folder of the file instead of when I change file. 
We could also do some pre-processing of the file's links?

Analyse these two fixed options and give me a prediction of how they would affect the user experience.

## 2026-03-27T16:05:57.973Z

Implement both options and also fix this bug. 

Verification:
1. Smart/Diverse
2. Yes.
3. Continuous scrolling

## 2026-03-27T16:05:57.974Z

Implement both options and also fix this bug. 

Verification:
1. Smart/Diverse
2. Yes.
3. Continuous scrolling

## 2026-03-28T08:41:29.402Z

Why does the reroll colour not change the color of the links, is it broken?

## 2026-03-28T09:24:48.041Z

Analyze this obsidian plugin for its ability to have links of perceptually diverse colors (no link conflict, do modifications even if same base color) and the speed performance

## 2026-03-28T09:48:17.092Z

What about the speed performance analysis?

Give me suggestions for fixing each bug. Does having my auto change of seed everytime I change parent folder of file, cause lag in any way?

## 2026-03-28T10:10:27.152Z

Bug: Hash mode change doesn't clear cache — Colors don't update until cache eviction or manual re-roll

fix this.

## 2026-03-28T10:37:58.975Z

commit this

## 2026-03-28T12:20:30.875Z

Right now there is an option to reset the colors of the links when the active file's parent folder changes. 

I want to keep this behaviour but make it so that it is (when the active file's parent folder changes AND a new file is opened). So that if I'm just clicking between my already open files, it won't reset the link colours.

## 2026-03-28T12:27:03.261Z

Do a commit

## 2026-03-28T12:29:59.925Z

I tried out the plugin and there is a bug when I click between the files. So the files are not changing. They are just all the same open files, but I'm trying to scroll between them. And when I click between my active files, changing which file is active, the scroll position of the files is changing. Can you investigate all possible causes of this bug? Do not stop at one. Carefully look through what this plugin might be doing.

## 2026-03-28T12:33:54.991Z

Yes, implement the fixes

## 2026-03-28T12:35:37.603Z

Keep going. Do a sanity check over all youru suggested fixes, will they break the code?

## 2026-03-28T12:39:58.450Z

Yes, apply the fix.

## 2026-03-28T12:43:09.900Z

The precomputeFileLinkColors call still runs for every file switch, including already-open files.
 This is acceptable (minimal performance impact, designed behavior), but could be optimized in the future by
 tracking which files have been precomputed.
