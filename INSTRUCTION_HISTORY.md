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
