// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState, useCallback} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch} from 'react-redux';
import styled from 'styled-components';
import {
    DragDropContext,
    DropResult,
    Droppable,
    DroppableProvided,
    Draggable,
    DraggableProvided,
    DraggableStateSnapshot,
} from 'react-beautiful-dnd';

import classNames from 'classnames';

import {FloatingPortal} from '@floating-ui/react-dom-interactions';

import {PlaybookRun, PlaybookRunStatus} from 'src/types/playbook_run';
import {
    finishRun,
    playbookRunUpdated,
} from 'src/actions';
import {
    Checklist,
    ChecklistItemState,
    ChecklistItem,
} from 'src/types/playbook';
import {
    clientMoveChecklist,
    clientMoveChecklistItem,
    clientAddChecklist,
} from 'src/client';
import {PrimaryButton, TertiaryButton} from 'src/components/assets/buttons';
import TutorialTourTip, {useMeasurePunchouts, useShowTutorialStep} from 'src/components/tutorial/tutorial_tour_tip';
import {RunDetailsTutorialSteps, TutorialTourCategories} from 'src/components/tutorial/tours';
import {ButtonsFormat as ItemButtonsFormat} from 'src/components/checklist_item/checklist_item';
import GiveFeedbackButton from 'src/components/give_feedback_button';

import {FullPlaybook, Loaded, useUpdatePlaybook} from 'src/graphql/hooks';

import {useProxyState} from 'src/hooks';

import CollapsibleChecklist, {ChecklistInputComponent, TitleHelpTextWrapper} from './collapsible_checklist';
import GenericChecklist, {generateKeys} from './generic_checklist';

// disable all react-beautiful-dnd development warnings
// @ts-ignore
window['__react-beautiful-dnd-disable-dev-warnings'] = true;

interface Props {
    playbookRun?: PlaybookRun;
    playbook?: Loaded<FullPlaybook>;
    enableFinishRun: boolean;
    isReadOnly: boolean;
    checklistsCollapseState: Record<number, boolean>;
    onChecklistCollapsedStateChange: (checklistIndex: number, state: boolean) => void;
    onEveryChecklistCollapsedStateChange: (state: Record<number, boolean>) => void;
    showItem?: (checklistItem: ChecklistItem, myId: string) => boolean;
    itemButtonsFormat?: ItemButtonsFormat;
}

const RHSGiveFeedbackButton = styled(GiveFeedbackButton)`
    && {
        color: var(--center-channel-color-64);
    }

    &&:hover:not([disabled]) {
        color: var(--center-channel-color-72);
        background-color: var(--center-channel-color-08);
    }
`;

const ChecklistList = ({
    playbookRun,
    playbook: inPlaybook,
    enableFinishRun,
    isReadOnly,
    checklistsCollapseState,
    onChecklistCollapsedStateChange,
    onEveryChecklistCollapsedStateChange,
    showItem,
    itemButtonsFormat,
}: Props) => {
    const dispatch = useDispatch();
    const {formatMessage} = useIntl();

    const checklistsPunchout = useMeasurePunchouts(
        ['pb-checklists-inner-container'],
        [],
        {y: -5, height: 10, x: -5, width: 10},
    );
    const showRunDetailsChecklistsStep = useShowTutorialStep(
        RunDetailsTutorialSteps.Checklists,
        TutorialTourCategories.RUN_DETAILS
    );
    const [addingChecklist, setAddingChecklist] = useState(false);
    const [newChecklistName, setNewChecklistName] = useState('');
    const [isDragging, setIsDragging] = useState(false);

    const updatePlaybook = useUpdatePlaybook(inPlaybook?.id);
    const [playbook, setPlaybook] = useProxyState(inPlaybook, useCallback((updatedPlaybook) => {
        const updated = updatedPlaybook?.checklists.map((cl) => {
            return {
                ...cl,
                items: cl.items.map((ci) => {
                    return {
                        title: ci.title,
                        description: ci.description,
                        state: ci.state,
                        stateModified: ci.state_modified || 0,
                        assigneeID: ci.assignee_id || '',
                        assigneeModified: ci.assignee_modified || 0,
                        command: ci.command,
                        commandLastRun: ci.command_last_run,
                        dueDate: ci.due_date,
                    };
                }),
            };
        });

        updatePlaybook({checklists: updated});
    }, [updatePlaybook]), 0);
    const checklists = playbookRun?.checklists || playbook?.checklists || [];
    const FinishButton = allComplete(checklists) ? StyledPrimaryButton : StyledTertiaryButton;
    const active = (playbookRun !== undefined) && (playbookRun.current_status === PlaybookRunStatus.InProgress);
    const finished = (playbookRun !== undefined) && (playbookRun.current_status === PlaybookRunStatus.Finished);
    const archived = playbook != null && playbook.delete_at !== 0 && !playbookRun;
    const disabled = finished || archived || isReadOnly;

    if (!playbook && !playbookRun) {
        return null;
    }

    const setChecklistsForPlaybook = (newChecklists: Checklist[]) => {
        if (!playbook) {
            return;
        }

        const updated = newChecklists.map((cl) => {
            return {
                ...cl,
                items: cl.items.map((ci) => {
                    return {
                        ...ci,
                        state_modified: ci.state_modified || 0,
                        assignee_id: ci.assignee_id || '',
                        assignee_modified: ci.assignee_modified || 0,
                    };
                }),
            };
        });

        setPlaybook({...playbook, checklists: updated});
    };

    const onRenameChecklist = (index: number, title: string) => {
        const newChecklists = [...checklists];
        newChecklists[index].title = title;
        setChecklistsForPlaybook(newChecklists);
    };

    const onDuplicateChecklist = (index: number) => {
        const newChecklist = {...checklists[index]};
        const newChecklists = [...checklists, newChecklist];
        setChecklistsForPlaybook(newChecklists);
    };

    const onDeleteChecklist = (index: number) => {
        const newChecklists = [...checklists];
        newChecklists.splice(index, 1);
        setChecklistsForPlaybook(newChecklists);
    };

    const onUpdateChecklist = (index: number, newChecklist: Checklist) => {
        const newChecklists = [...checklists];
        newChecklists[index] = {...newChecklist};
        setChecklistsForPlaybook(newChecklists);
    };

    const onDragStart = () => {
        setIsDragging(true);
    };

    const onDragEnd = (result: DropResult) => {
        setIsDragging(false);

        // If the item is dropped out of any droppable zones, do nothing
        if (!result.destination) {
            return;
        }

        const [srcIdx, dstIdx] = [result.source.index, result.destination.index];

        // If the source and desination are the same, do nothing
        if (result.destination.droppableId === result.source.droppableId && srcIdx === dstIdx) {
            return;
        }

        // Copy the data to modify it
        const newChecklists = Array.from(checklists);

        // Move a checklist item, either inside of the same checklist, or between checklists
        if (result.type === 'checklist-item') {
            const srcChecklistIdx = parseInt(result.source.droppableId, 10);
            const dstChecklistIdx = parseInt(result.destination.droppableId, 10);

            if (srcChecklistIdx === dstChecklistIdx) {
                // Remove the dragged item from the checklist
                const newChecklistItems = Array.from(checklists[srcChecklistIdx].items);
                const [removed] = newChecklistItems.splice(srcIdx, 1);

                // Add the dragged item to the checklist
                newChecklistItems.splice(dstIdx, 0, removed);
                newChecklists[srcChecklistIdx] = {
                    ...newChecklists[srcChecklistIdx],
                    items: newChecklistItems,
                };
            } else {
                const srcChecklist = checklists[srcChecklistIdx];
                const dstChecklist = checklists[dstChecklistIdx];

                // Remove the dragged item from the source checklist
                const newSrcChecklistItems = Array.from(srcChecklist.items);
                const [moved] = newSrcChecklistItems.splice(srcIdx, 1);

                // Add the dragged item to the destination checklist
                const newDstChecklistItems = Array.from(dstChecklist.items);
                newDstChecklistItems.splice(dstIdx, 0, moved);

                // Modify the new checklists array with the new source and destination checklists
                newChecklists[srcChecklistIdx] = {
                    ...srcChecklist,
                    items: newSrcChecklistItems,
                };
                newChecklists[dstChecklistIdx] = {
                    ...dstChecklist,
                    items: newDstChecklistItems,
                };
            }

            // Persist the new data in the server
            if (playbookRun) {
                clientMoveChecklistItem(playbookRun.id, srcChecklistIdx, srcIdx, dstChecklistIdx, dstIdx);
            }
        }

        // Move a whole checklist
        if (result.type === 'checklist') {
            const [moved] = newChecklists.splice(srcIdx, 1);
            newChecklists.splice(dstIdx, 0, moved);

            if (playbookRun) {
                // The collapsed state of a checklist in the store is linked to the index in the list,
                // so we need to shift all indices between srcIdx and dstIdx to the left (or to the
                // right, depending on whether srcIdx < dstIdx) one position
                const newState = {...checklistsCollapseState};
                if (srcIdx < dstIdx) {
                    for (let i = srcIdx; i < dstIdx; i++) {
                        newState[i] = checklistsCollapseState[i + 1];
                    }
                } else {
                    for (let i = dstIdx + 1; i <= srcIdx; i++) {
                        newState[i] = checklistsCollapseState[i - 1];
                    }
                }
                newState[dstIdx] = checklistsCollapseState[srcIdx];

                onEveryChecklistCollapsedStateChange(newState);

                // Persist the new data in the server
                clientMoveChecklist(playbookRun.id, srcIdx, dstIdx);
            }
        }

        // Update the store with the new checklists
        if (playbookRun) {
            dispatch(playbookRunUpdated({
                ...playbookRun,
                checklists: newChecklists,
            }));
        } else {
            setChecklistsForPlaybook(newChecklists);
        }
    };

    let addChecklist = (
        <AddChecklistLink
            disabled={archived}
            onClick={(e) => {
                e.stopPropagation();
                setAddingChecklist(true);
            }}
            data-testid={'add-a-checklist-button'}
        >
            <IconWrapper>
                <i className='icon icon-plus'/>
            </IconWrapper>
            {formatMessage({defaultMessage: 'Add a checklist'})}
        </AddChecklistLink>
    );

    if (addingChecklist) {
        addChecklist = (
            <NewChecklist>
                <Icon className={'icon-chevron-down'}/>
                <ChecklistInputComponent
                    title={newChecklistName}
                    setTitle={setNewChecklistName}
                    onCancel={() => {
                        setAddingChecklist(false);
                        setNewChecklistName('');
                    }}
                    onSave={() => {
                        const newChecklist = {title: newChecklistName, items: [] as ChecklistItem[]};
                        if (playbookRun) {
                            clientAddChecklist(playbookRun.id, newChecklist);
                        } else {
                            setChecklistsForPlaybook([...checklists, newChecklist]);
                        }
                        setTimeout(() => setNewChecklistName(''), 300);
                        setAddingChecklist(false);
                    }}
                />
            </NewChecklist>
        );
    }

    const keys = generateKeys(checklists.map((checklist) => checklist.title));

    return (
        <>
            <DragDropContext
                onDragEnd={onDragEnd}
                onDragStart={onDragStart}
            >
                <Droppable
                    droppableId={'all-checklists'}
                    direction={'vertical'}
                    type={'checklist'}
                >
                    {(droppableProvided: DroppableProvided) => (
                        <ChecklistsContainer
                            {...droppableProvided.droppableProps}
                            className={classNames('checklists', {isDragging})}
                            ref={droppableProvided.innerRef}
                        >
                            {checklists.map((checklist: Checklist, checklistIndex: number) => (
                                <Draggable
                                    key={keys[checklistIndex]}
                                    draggableId={checklist.title + checklistIndex}
                                    index={checklistIndex}
                                >
                                    {(draggableProvided: DraggableProvided, snapshot: DraggableStateSnapshot) => {
                                        const component = (
                                            <CollapsibleChecklist
                                                draggableProvided={draggableProvided}
                                                title={checklist.title}
                                                items={checklist.items}
                                                index={checklistIndex}
                                                collapsed={Boolean(checklistsCollapseState[checklistIndex])}
                                                setCollapsed={(newState) => onChecklistCollapsedStateChange(checklistIndex, newState)}
                                                disabled={disabled}
                                                playbookRunID={playbookRun?.id}
                                                onRenameChecklist={onRenameChecklist}
                                                onDuplicateChecklist={onDuplicateChecklist}
                                                onDeleteChecklist={onDeleteChecklist}
                                                titleHelpText={playbook ? (
                                                    <TitleHelpTextWrapper>
                                                        {formatMessage(
                                                            {defaultMessage: '{numTasks, number} {numTasks, plural, one {task} other {tasks}}'},
                                                            {numTasks: checklist.items.length},
                                                        )}
                                                    </TitleHelpTextWrapper>
                                                ) : undefined}
                                            >
                                                <GenericChecklist
                                                    playbookRun={playbookRun}
                                                    disabled={disabled}
                                                    checklist={checklist}
                                                    checklistIndex={checklistIndex}
                                                    onUpdateChecklist={(newChecklist: Checklist) => onUpdateChecklist(checklistIndex, newChecklist)}
                                                    showItem={showItem}
                                                    itemButtonsFormat={itemButtonsFormat}
                                                />
                                            </CollapsibleChecklist>
                                        );

                                        if (snapshot.isDragging) {
                                            return <FloatingPortal>{component}</FloatingPortal>;
                                        }

                                        return component;
                                    }}
                                </Draggable>
                            ))}
                            {droppableProvided.placeholder}
                        </ChecklistsContainer>
                    )}
                </Droppable>
                {!disabled && addChecklist}
            </DragDropContext>
            {
                active && enableFinishRun && playbookRun &&
                <FinishButton onClick={() => dispatch(finishRun(playbookRun?.team_id || ''))}>
                    {formatMessage({defaultMessage: 'Finish run'})}
                </FinishButton>
            }
            <RHSGiveFeedbackButton/>
            {showRunDetailsChecklistsStep && (
                <TutorialTourTip
                    title={<FormattedMessage defaultMessage='Track progress and ownership'/>}
                    screen={<FormattedMessage defaultMessage='Assign, check off, or skip tasks to ensure the team is clear on how to move toward the finish line together.'/>}
                    tutorialCategory={TutorialTourCategories.RUN_DETAILS}
                    step={RunDetailsTutorialSteps.Checklists}
                    showOptOut={false}
                    placement='left'
                    pulsatingDotPlacement='top-start'
                    pulsatingDotTranslate={{x: 0, y: 0}}
                    width={352}
                    autoTour={true}
                    punchOut={checklistsPunchout}
                    telemetryTag={`tutorial_tip_Playbook_Run_Details_${RunDetailsTutorialSteps.Checklists}_Checklists`}
                />
            )}
        </>
    );
};

const AddChecklistLink = styled.button`
    font-size: 14px;
    font-weight: 600;
    line-height: 20px;
    height: 44px;
    width: 100%;

    background: none;
    border: none;

    border-radius: 4px;
    border: 1px dashed;
    display: flex;
    flex-direction: row;
    align-items: center;
    cursor: pointer;

    border-color: var(--center-channel-color-16);
    color: var(--center-channel-color-64);

    &:hover:not(:disabled) {
        background-color: var(--button-bg-08);
        color: var(--button-bg);
    }
`;

const NewChecklist = styled.div`
    background-color: rgba(var(--center-channel-color-rgb), 0.04);
    z-index: 1;
    position: sticky;
    top: 48px; // height of rhs_checklists MainTitle
    border-radius: 4px 4px 0px 0px;

    display: flex;
    flex-direction: row;
    align-items: center;
`;

const Icon = styled.i`
    position: relative;
    top: 2px;
    margin: 0 0 0 6px;

    font-size: 18px;
    color: rgba(var(--center-channel-color-rgb), 0.56);
`;

const ChecklistsContainer = styled.div`
`;

const IconWrapper = styled.div`
    padding: 3px 0 0 1px;
    margin: 0;
`;

const StyledTertiaryButton = styled(TertiaryButton)`
    display: inline-block;
    margin: 12px 0;
`;

const StyledPrimaryButton = styled(PrimaryButton)`
    display: inline-block;
    margin: 12px 0;
`;

export default ChecklistList;

const allComplete = (checklists: Checklist[]) => {
    return notFinishedTasks(checklists) === 0;
};

const notFinishedTasks = (checklists: Checklist[]) => {
    let count = 0;
    for (const list of checklists) {
        for (const item of list.items) {
            if (item.state === ChecklistItemState.Open || item.state === ChecklistItemState.InProgress) {
                count++;
            }
        }
    }
    return count;
};
