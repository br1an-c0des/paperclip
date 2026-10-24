# UI
New *Tasks* page that is more fully featured and interactive.
More like a clickup page.  

# other changes/improvements
+ Be able to specify ticket prefix's manually, per project

# my paperclip rebuild

+ "Agents" should open an endless chat window that shows either in progress runs, or ready for input if starting with plain chat.
+ "Tasks" become separated from actual agent chats/runs.
+ The timeline of a tasks progress gets shown in the right sidebar, as short notes and comments.  a history/log of the task in process.  
+ You can then "go to" the actual chat/run stream, which is the agent itself, and interrupt, add notes/context, or start a new conversation altogether. 

**It's mostly about rebuilding and redesigning the whole UX and organization of concepts**


# agent dm chats
+ One ongoing infinite chat that exists *outside* of task runs. 
+ the backend for this already seems to mostly exist
+ would primarily just be a ui redesign
+ may need to make small adjustments

## task runs
Can be opened up as *separate* chat windows, to view the details of the run, and interact with that agent on *that specific run*

# tasks
+ AI should create @user tags in the comments to assign as waiting on someone else to review
## statuses
+ be able to configure and define custom status text
+ define which status's trigger certain actions like a "review" or "approval" action by the assigned reviewer or approver.

## custom fields
+ be able to create custom fields/columns for tasks
+ Or at least a "tags" field.  Something that can allow categorizing tasks with custom labels

## multiple lists / "Sprints"
be able to create multiple lists per project, similar to clickup behavior

could also be more intentionally called **sprints** or **sprint lists**

then rework the project dashboard to include/display all "sprints" in more of an overview.

### combine with goals?
make "goals" assignable to individual lists/sprints.

so a single it becomes one unified concept of one list per sprint per goal.

# decisions
It should *not* have a separate page.

# routines
+ these should just become normal tasks with an option of "recurring". 
+ So you create it just like any other task, but then mark it as recurring, which then gives you additional options for *when* to trigger it.
+ It should *not* be it's own page.

# goals
+ Define goals as part of a project
+ Could just be part of the project description.
+ ensure that the Project description and goals are submitted as context for any task run that is executed within that project.

+ it should *not* have it's own page

# strategy approval
the specific ceo strategy approval should probably just get dropped.  it seems way to specific.  

the "approval" just needs to get more properly generalized and combined into the singular "requests" concept.

as long as the concept of *governance* on certain actions is properly formalized in an abstract way, that's what is actually important.


# attachments + docs + artifacts
+ be able to attach documents/attachments to an entire project, so that these docs become available to reference for *any* task that is executed within the project.  
	+ this should then get injected as part of the overall project prompt that gets added to a run that includes the project's description and goals.  
	+ would include a list of all the core attachment docs/references that are attached to the project, along with a small description of the document, so the agent can then choose whether or not to go back to it or not.
+ Documents/attachments could be *either* objects that are submitted *outside* of a repo, *or* they could also be references to existing files within a repo/workspace???
+ Docs/artifacts created by agents should *appear* as if they are same class of objects.  To the primary human user, there should be no visual difference between attachments/docs uploaded by the user and attachments/docs/artifacts created by the agent.  They should just look like the same kind of attachment.

# paperclip runner visibility
+ create a more direct visibility of the paperclip runner information/data.  
+ integrate the data that paperclip runner creates and uses more tightly into the UI.  
+ Or at least make that data available to be seen.

# memory
make memory documents easily visible per agent, through the "agent management" settings page.

Also ensure that memory files are properly accessible *per agent* for every run (making sure that subsequent runs have proper access to memory)

In general, I feel like the entire memory integration really needs cleaning up, especially when it comes to using claude.  Need to address all the different memory options, and make sure each one behaves correctly and smoothly.  

perhaps it's beneficial to store memory in the postgres database?  Or to just administer some kind of custom memory mcp server to make the issues of making sure memory files are available for every run per agent properly?

# brand new ideas

## voting
allow agents to vote on issues or proposals as a group.  
+ one agent can propose something with a clear set of options or a yes/no.
+ Then all other agents that are included/involved in the issue get to vote.  
+ An agent could even have the option to ask a question or propose an amendment or change instead of voting.

## group announcement channels
+ A group chat/channel where a user (or even another agent) can send messages to all agents (or included agents) that each agent can then make note of in their individual memory.  Or look into certain issues or tasks as needed.

## more abstract generic task relationships
+ be able to simply make a comment that mentions another task?
+ try to match how clickup manages task relationships and dependancies

## assigned comments
+ try to mimic clickup functionality more, to create assignments via comments
+ !!! perhaps this is how review stages/assignments could work?

## meetings
+ scheduled "work sessions" with an agent.
+ it just opens up a new session/chat with the chosen agent
+ but it's mostly about scheduling certain points in time
+ goals:
	+ to get the user to work through things
	+ have an agent present things or work through issues with the user.

Confirm whether or not there's a way to create a "fast mode" of a paperclip integration for use with meetings so that response times can be quicker?

## built in markdown document editor??
+ this may already be implemented in some way?
+ Be able to "create" documents within projects, similar to clickup.
+ Would be a good way for communication of ideas, plans, notes, etc.

# other notes

## core skill add-on
create new add-on core skill (do not replace core skill) to try and resolve any new changes or new features that come up.

